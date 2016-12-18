'use strict';

var request = require('request');
var _ = require('underscore');
var similarity = require('string-similarity');
var sbd = require('sbd');
var AlexaSkill = require('./AlexaSkill');

var APP_ID = process.env.appId;
var apiUrl = 'https://ridb.recreation.gov/api/v1/';
var ridbAuth = { apikey: process.env.ridbApiKey };
var mapsAuth = { key: process.env.mapsApiKey };

// RIDB expects a two-letter state code, so we want to check against them and map the state name if needed
var states = {
	abbr: ['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy'],
	fullName: {'alabama': 'al', 'alaska': 'ak', 'arizona': 'az', 'arkansas': 'ar', 'california': 'ca', 'colorado': 'co', 'connecticut': 'ct', 'delaware': 'de', 'florida': 'fl', 'georgia': 'ga', 'hawaii': 'hi', 'idaho': 'id', 'illinois': 'il', 'indiana': 'in', 'iowa': 'ia', 'kansas': 'ks', 'kentucky': 'ky', 'louisiana': 'la', 'maine': 'me', 'maryland': 'md', 'massachusetts': 'ma', 'michigan': 'mi', 'minnesota': 'mn', 'mississippi': 'ms', 'missouri': 'mo', 'montana': 'mt', 'nebraska': 'ne', 'nevada': 'nv', 'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', 'ohio': 'oh', 'oklahoma': 'ok', 'oregon': 'or', 'pennsylvania': 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd', 'tennessee': 'tn', 'texas': 'tx', 'utah': 'ut', 'vermont': 'vt', 'virginia': 'va', 'washington': 'wa', 'west virginia': 'wv', 'wisconsin': 'wi', 'wyoming': 'wy'} };

var RecreationSites = function () {
	AlexaSkill.call(this, APP_ID);
};

var errorResponse = function(response) {
	return response.tell('I\'m sorry, something went wrong with r. i. d. b.');
};

var getRecAreas = function() {
	var hasQuery = arguments.length === 2;
	request.get(apiUrl + 'recareas/', {
		headers: ridbAuth,
		qs: hasQuery ? arguments[0] : null
	}, hasQuery ? arguments[1] : arguments[0]);
};

var reportCount = function(data, location, response) {
	if (!data.METADATA) {
		return errorResponse(response);
	}
	response.ask('I found ' + data.METADATA.RESULTS.TOTAL_COUNT + ' recreation areas ' + location + '. You can ask about a specific location for more details.', 'Try asking about a city or town.');
};

var getRecreationAreas = function(intent, session, response) {
	getRecAreas(function(error, res, body) {
		if (error) {
			console.log(error);
			return errorResponse(response);
		}
		reportCount(JSON.parse(body), 'nationwide', response);
	});
};

// Extend AlexaSkill
RecreationSites.prototype = Object.create(AlexaSkill.prototype);
RecreationSites.prototype.constructor = RecreationSites;

RecreationSites.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
	console.log('RecreationSites onSessionStarted requestId: ' + sessionStartedRequest.requestId + ', sessionId: ' + session.sessionId);
	// any initialization logic goes here
};

RecreationSites.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
	console.log('RecreationSites onLaunch requestId: ' + launchRequest.requestId + ', sessionId: ' + session.sessionId);
	getRecreationAreas(null, session, response);
};

RecreationSites.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
	console.log('RecreationSites onSessionEnded requestId: ' + sessionEndedRequest.requestId + ', sessionId: ' + session.sessionId);
	// any cleanup logic goes here
};

var getRecreationAreasForState = function(intent, session, response) {
	var stateSlot = intent.slots.State;
	if (!stateSlot || !stateSlot.value) {
		return errorResponse(response);
	}
	var stateValue = stateSlot.value.toLowerCase();
	var stateAbbr = stateValue;
	if (!_(states.abbr).contains(stateValue)) {
		if (states.fullName[stateValue]) {
			stateAbbr = states.fullName[stateValue];
		} else {
			return errorResponse(response);
		}
	}
	getRecAreas({ state: stateAbbr }, function(error, res, body) {
		if (error) {
			return errorResponse();
		}
		reportCount(JSON.parse(body), 'in ' + _(states.fullName).findKey(function(val) { return val === stateAbbr; }), response);
	});
};

var getRecreationAreasForCity = function(intent, session, response) {
	var citySlot = intent.slots.City;
	if (!citySlot || !citySlot.value) {
		return errorResponse();
	}
	var radius = 50;
	var radiusSlot = intent.slots.Radius;
	if (radiusSlot && radiusSlot.value) {
		radius = radiusSlot.value;
	}
	var cityName = citySlot.value;
	request.get('https://maps.googleapis.com/maps/api/geocode/json', {
		qs: _({ address: cityName }).extend(mapsAuth)
	}, function(error, res, body) {
		if (error) {
			console.log(error);
			return errorResponse();
		}
		var parsed = JSON.parse(body);
		if (!parsed.results.length) {
			return response.ask('I wasn\'t able to find ' + cityName + '. Please ask again.', 'Say the name of a city or town.');
		}
		var location = parsed.results[0].geometry.location;
		getRecAreas({
			latitude: location.lat,
			longitude: location.lng,
			radius: radius
		}, function(error, res, body) {
			if (error) {
				console.log(error);
				return errorResponse();
			}
			var parsed = JSON.parse(body);
			var count = parsed.METADATA.RESULTS.TOTAL_COUNT;
			if (!count) {
				return response.tell('Sorry, r.i.d.b. couldn\'t find any recreation areas within ' + radius + ' miles of ' + cityName);
			}
			var areas = parsed.RECDATA;
			var sampledAreas = _(areas).sample(7);
			var areasToSay = _(sampledAreas).pluck('RecAreaName').join(', ');
			session.attributes.sampledAreas = sampledAreas;
			session.attributes.count = count;
			session.attributes.radius = radius;
			response.ask('I found ' + count + ' recreation areas within ' + radius + ' miles of ' + cityName + '. Here are a few: ' + areasToSay, 'You can ask about a recreation site to get more information.');
		});
	});
};

// Get details for a specified recreation area
var getRecreationArea = function(intent, session, response) {
	var recAreaSlot = intent.slots.RecArea;
	if (!recAreaSlot || !recAreaSlot.value) {
		return errorResponse(response);
	}
	var recAreaName = recAreaSlot.value;
	var sampledAreas = session.attributes.sampledAreas;
	// reset session
	session.attributes = {};
	var match = similarity.findBestMatch(recAreaName, _(sampledAreas).pluck('RecAreaName'));
	var name = match.bestMatch.target;
	var matchingRecArea = _(sampledAreas).findWhere({
		RecAreaName: name
	});
	if (!matchingRecArea) {
		return response.ask('I didn\'t understand that recreation area name.',  'You can ask about ' + _(sampledAreas).pluck('RecAreaName').join(', '));
	}
	session.attributes.currentArea = matchingRecArea;
	var description = matchingRecArea.RecAreaDescription;
	response.ask(name + ': ' + sbd.sentences(description)[0] + ' Would you like directions to ' + name + '?');
};

var giveDirections = function(intent, session, response) {
	var currentArea = session.attributes.currentArea;
	if (!currentArea) {
		return response.tell('I\'m sorry, I didn\'t understand that request');
	}
	var name = currentArea.RecAreaName;
	response.tellWithCard('Okay, I\'m sending directions to the Alexa app. Enjoy ' + name + '!', 'Directions to ' + name, currentArea.RecAreaDirections);
};

RecreationSites.prototype.intentHandlers = {
	// register custom intent handlers
	GetRecreationAreas: getRecreationAreas,
	GetRecreationAreasForState: getRecreationAreasForState,
	GetRecreationAreasForCity: getRecreationAreasForCity,
	GetRecreationArea: getRecreationArea,
	'AMAZON.YesIntent': giveDirections,
	'AMAZON.NoIntent': function(intent, session, response) {
		if (!session.attributes.currentArea) {
			return response.tell('I\'m sorry, I didn\'t understand that request');
		}
		response.tell('Okay. Have a great day!');
	},
	'AMAZON.HelpIntent': function (intent, session, response) {
		response.ask('Ask r.i.d.b. about recreation areas near you.', 'Try asking r.i.d.b. about your city or town.');
	}
};

// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
	// Create an instance of the RecreationSites skill.
	var recreationSites = new RecreationSites();
	recreationSites.execute(event, context);
};

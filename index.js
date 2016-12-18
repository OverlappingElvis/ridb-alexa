var request = require('request');
var _ = require('underscore');
var AlexaSkill = require('./AlexaSkill');

var APP_ID = 'amzn1.ask.skill.c27a692e-b588-4211-ab6e-26b4d8c40619';
var apiUrl = 'https://ridb.recreation.gov/api/v1/';
var ridbAuth = { apikey: process.env.ridbApiKey };
var mapsAuth = { key: process.env.mapsApiKey };

var states = {
	abbr: ['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy'],
	fullName: {'alabama': 'al', 'alaska': 'ak', 'arizona': 'az', 'arkansas': 'ar', 'california': 'ca', 'colorado': 'co', 'connecticut': 'ct', 'delaware': 'de', 'florida': 'fl', 'georgia': 'ga', 'hawaii': 'hi', 'idaho': 'id', 'illinois': 'il', 'indiana': 'in', 'iowa': 'ia', 'kansas': 'ks', 'kentucky': 'ky', 'louisiana': 'la', 'maine': 'me', 'maryland': 'md', 'massachusetts': 'ma', 'michigan': 'mi', 'minnesota': 'mn', 'mississippi': 'ms', 'missouri': 'mo', 'montana': 'mt', 'nebraska': 'ne', 'nevada': 'nv', 'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', 'ohio': 'oh', 'oklahoma': 'ok', 'oregon': 'or', 'pennsylvania': 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd', 'tennessee': 'tn', 'texas': 'tx', 'utah': 'ut', 'vermont': 'vt', 'virginia': 'va', 'washington': 'wa', 'west virginia': 'wv', 'wisconsin': 'wi', 'wyoming': 'wy'} };

var RecreationSites = function () {
	AlexaSkill.call(this, APP_ID);
};

// Extend AlexaSkill
RecreationSites.prototype = Object.create(AlexaSkill.prototype);
RecreationSites.prototype.constructor = RecreationSites;

RecreationSites.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
	console.log('RecreationSites onSessionStarted requestId: ' + sessionStartedRequest.requestId
		+ ', sessionId: ' + session.sessionId);
	// any initialization logic goes here
};

RecreationSites.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
	console.log('RecreationSites onLaunch requestId: ' + launchRequest.requestId + ', sessionId: ' + session.sessionId);
	getRecreationAreas(null, session, response);
};

RecreationSites.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
	console.log('RecreationSites onSessionEnded requestId: ' + sessionEndedRequest.requestId
		+ ', sessionId: ' + session.sessionId);
	// any cleanup logic goes here
};

var errorResponse = function(response) {
	return response.tell('I\'m sorry, but I\'m unable to retrieve the information you requested.');
};

var reportCount = function(data, location, response) {
	if (!data.METADATA) {
		return errorResponse(response);
	}
	response.ask('I found ' + data.METADATA.RESULTS.TOTAL_COUNT + ' recreation areas ' + location + '. You can ask about a specific location for more details.', 'Try asking about a city or town.');
};

var getRecAreas = function() {
	var hasQuery = arguments.length === 2;
	request.get(apiUrl + 'recareas/', {
		headers: ridbAuth,
		qs: hasQuery ? arguments[0] : null
	}, hasQuery ? arguments[1] : arguments[0]);
};

// Configure intents
var getRecreationAreas = function(intent, session, response) {
	getRecAreas(function(error, res, body) {
		if (error) {
			console.log(error);
			return errorResponse(response);
		}
		reportCount(JSON.parse(body), 'nationwide', response);
	});
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
			return response.ask('I wasn\'t able to find ' + cityName + '. Please ask again.', 'Say the name of a city or town.')
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
				return response.tell('Sorry, I couldn\'t find any recreation areas within ' + radius + ' miles of ' + cityName);
			}
			response.tell('I found ' + parsed.METADATA.RESULTS.TOTAL_COUNT + ' recreation areas within ' + radius + ' miles of ' + cityName + '.');
		});
	});
};

RecreationSites.prototype.intentHandlers = {
	// register custom intent handlers
	GetRecreationAreas: getRecreationAreas,
	GetRecreationAreasForState: getRecreationAreasForState,
	GetRecreationAreasForCity: getRecreationAreasForCity,
	'AMAZON.HelpIntent': function (intent, session, response) {
		response.ask('You can ask me about recreation areas near your location.', 'Try asking about your city or town.');
	}
};

// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
	// Create an instance of the RecreationSites skill.
	var recreationSites = new RecreationSites();
	recreationSites.execute(event, context);
};

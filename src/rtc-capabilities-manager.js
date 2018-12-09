
/*
* Blue Jeans WebRTC Capabilities Manager
* =====================================================================================
* @version In bower.json
* @Scope Figures out what WebRTC features are supported by the current browser
*
*/

var my   				  = require('myclass');
var _       			= require('underscore');
var Backbone 			= require('backbone');
var Logger				= require('Logger');
var Q             = require('q');

var RTCCapabilitiesModel = Backbone.Model.extend({

    defaults: {
      'supportsOutputSpeakerSelection': null
    }
});

var RTCCapabilitiesManager = my.Class({

    STATIC: {
    },

    constructor: function(params){
        _.bindAll(this);

        this.model = new RTCCapabilitiesModel();
    },

    detectCapabilities: function() {
      var deferred = Q.defer();
        this.detectOutputSpeakerSelection();
        deferred.resolve();
        return deferred.promise;
    },

    detectOutputSpeakerSelection: function() {
      $('body').append('<video id="testSpeakerSelection" style="display:none"></video>');

      var testEl = $('#testSpeakerSelection')[0];
      this.model.set('supportsOutputSpeakerSelection', (testEl && testEl.setSinkId !== undefined) ? true : false);
      $('#testSpeakerSelection').remove();
    }

});

module.exports = new RTCCapabilitiesManager();

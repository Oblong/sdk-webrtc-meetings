var my   				= require('myclass');
var _       			= require('underscore');
var Backbone 			= require('backbone');
var Logger				= require('Logger');
var RTCCallStatsModel   = require('./rtc-call-stats-model');
var BrowserDetector     = require('browserDetector');

var RTCCallStats = my.Class({

    STATIC: {
    },

    constructor: function(options) {
        _.bindAll(this);
        _.extend(this, Backbone.Events);
        this.model = new RTCCallStatsModel();
        this.peerConnection = options.peerConnection;
        this.pollInterval = options.statsPollInterval;
    },

    startPollingStats: function() {
        var self = this;
        if(!this.pollStatsHandle) {
            Logger.debug('RTCCallStats: Starting call stats poll with interval: ', this.pollInterval);
            this.pollStatsHandle = window.setInterval(function() {
                self.getStats({
                    peerConnection: self.peerConnection,
                    success: self.getStatsSuccess,
                    error: self.getStatsError
                });
            }, this.pollInterval);
        }
    },

    stopPollingStats: function() {
        if(!this.pollStatsHandle) {
            Logger.warn('RTCCallStats: Call stats poll already stopped');
            return;
        }
        Logger.debug('RTCCallStats: Stopping call stats poll');
        window.clearInterval(this.pollStatsHandle);
        this.pollStatsHandle = null;
    },

    getStats: function(params) {
        var pc = params.peerConnection;
        if(pc && pc.getStats) {
            pc.getStats(null,params.success, params.error);
        }
    },

    getStatsSuccess: function(stats) {
        if(BrowserDetector.browser === 'firefox'){
            //Update call stats to detect ICE connection issues
            this.trigger("rtcstats", stats);
        }
        this.model.updateStats(stats);
    },

    getStatsError: function(err) {
        Logger.error('RTCCallStats: Failed to get webrtc call stats', err);
    },

    close: function() {
        this.stopPollingStats();
        this.model.set(RTCCallStatsModel.defaults);
    }

});

module.exports = RTCCallStats;

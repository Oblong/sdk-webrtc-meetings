var Backbone 			= require('backbone');
var _ 					= require('underscore');
var Logger				= require('Logger');
  var BrowserDetector     = require('browserDetector');

var RTCCallStatsModel = Backbone.Model.extend({

      STATIC: {
          LABELS: {
              VIDEO_TRACK: 'video_label',
              CONTENT_TRACK: 'content_label'
          }
      },

      defaults: {
          //Local Audio Stream stats
        audioInputLevel        : null,
          audioPacketsSent       : null,

          // Remote Audio Stream stats
          audioPacketsRecvd      : null,

        // Remote Video Stream stats
        videoRecvHeight 		: null,
        videoRecvWidth 			: null,

        // Remote Content Stream stats
        contentRecvHeight		: null,
        contentRecvWidth 		: null
      },

      updateStats: function(stats) {
          var items = [];
          Object.keys(stats).forEach(function(key) {
              var item = {};
              var res = stats[key];
              Object.keys(res).forEach(function(k) {
                  item[k] = res[k];
              });
              items.push(item);
          });
          this.parseStats(items);
      },

      parseStats: function(items) {
        var newStats = {};
          var self = this;
        _.each(items, function(data, i, list) {
              if(BrowserDetector.browser !== 'firefox'){
              if(data.type === 'ssrc') {

                      if(data.id && (data.id.indexOf('_send') !== -1)) {
                          // Find the Local Audio Stream Stats Object by checking for presence of 'audioInputLevel' key
                          if(!_.isUndefined(data.audioInputLevel)) {
                              newStats.audioInputLevel = data.audioInputLevel;
                              newStats.audioPacketsSent = data.packetsSent;
                          }
                      }
                      if(data.id && (data.id.indexOf('_recv') !== -1)) {
                          // Find the Local Audio Stream Stats Object by checking for presence of 'audioOutputLevel' key
                          if(!_.isUndefined(data.audioOutputLevel)) {
                              newStats.audioPacketsRecvd = data.packetsReceived;
                          }
                      }
                      else {
                          switch(data.googTrackId) {

                              case self.STATIC.LABELS.VIDEO_TRACK:
                                      newStats.videoRecvHeight = data.googFrameHeightReceived ? parseInt(data.googFrameHeightReceived, 10) : null;
                                      newStats.videoRecvWidth = data.googFrameWidthReceived ? parseInt(data.googFrameWidthReceived, 10) : null;
                                      break;

                              case self.STATIC.LABELS.CONTENT_TRACK:
                                      newStats.contentRecvHeight = data.googFrameHeightReceived ? parseInt(data.googFrameHeightReceived, 10) : null;
                                      newStats.contentRecvWidth = data.googFrameWidthReceived ? parseInt(data.googFrameWidthReceived, 10) : null;
                                      break;
                              }
                          }
                      }
                  } else {
                      if(data.type === 'outboundrtp' && data.mediaType === 'audio') {
                          newStats.audioPacketsSent = data.packetsSent;
                      } else if(data.type === 'inboundrtp' && data.mediaType === 'audio') {
                          newStats.audioPacketsRecvd = data.packetsReceived;
                      }
                  }
        });

        this.set(newStats);
      }
  });

module.exports = RTCCallStatsModel;

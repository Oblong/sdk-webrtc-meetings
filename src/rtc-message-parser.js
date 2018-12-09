/*
* Blue Jeans WebRTC Signalling Message Parser
* =====================================================================================
* @version In bower.json
* @uses Utility which can understands the custom BJN JSON-RPC protocol: BlueJay
*
*/


var my             = require('myclass');
var _              = require('underscore');
var Logger         = require('Logger');
var RTCBlueJay     = require('./rtc-bluejay');
var RTCErrors      = require('./rtc-error');

var RTCMessageParser = my.Class({
  STATIC: {
          SUPPORTED_METHODS: _.values(RTCBlueJay.METHODS),
          ERROR: RTCErrors.SIGNALING_ERRORS
      },

  constructor : function(options) {
    _.bindAll(this);
    this.callbacks = options.callbacks;
  },

  getMessgeType: function(message) {
    if(_.isUndefined(message.id)) {
      return 'notification';
    } else if(!_.isEmpty(message.error)) {
      return 'error';
    } else if(!_.isEmpty(message.result)) {
      return 'response';
    } else if (!_.isEmpty(message.params)) {
      return 'request';
    }
    Logger.error('Message passed is in invalid format. Supported message types are: request, response, error, notification');
    return 'invalid';
  },

  parseIncomingMessage: function(msg) {
          var self = this;
    var message = JSON.parse(msg);
          var parseFailure = function(error) {
              self.callbacks['invalidMessage'].apply(self, [message, error]);
          };
          var parseSuccess = function(){
              var msgType = self.getMessgeType(message);
              if(typeof self.callbacks[msgType] === 'function') {
                  self.callbacks[msgType].apply(self, [message]);
              }
          };

          this.validateMessage(message, parseSuccess, parseFailure);
  },

  validateMessage: function(message, successCb, failureCb) {
    var callId = RTCBlueJay.getCallId();

    if(_.isNull(message.call) || _.isUndefined(message.call)) {
      Logger.error("Invalid message received from Remote Server, 'call' field not defined in message");
              failureCb(RTCMessageParser.ERROR.BAD_REQUEST);
    } else if (message.call !== callId) {
              Logger.error("Invalid call id, Transaction does not exists");
              failureCb(RTCMessageParser.ERROR.DOESNOT_EXIST);
          } else if(!_.isUndefined(message.method) && _.indexOf(RTCMessageParser.SUPPORTED_METHODS, message.method) === -1) {
      Logger.error("Invalid message received from Remote Server, 'method' passed is not supported: " + message.method);
              failureCb(RTCMessageParser.ERROR.METHOD_NOT_IMPLEMENTED);
    } else {
              successCb();
          }
  }
});

module.exports = RTCMessageParser;

const my = require('myclass');
const _ = require('underscore');
const Logger = require('Logger');

/*
* Blue Jeans WebRTC Signalling Protocol
* =====================================================================================
* @version In bower.json
* @uses Utility which can understands the custom BJN JSON-RPC protocol: BlueJay
*
*/

var RTCBlueJay = my.Class({

    STATIC: {
        MESSAGE_BASE: {"bluejay": "1.0"}
    },

    constructor : function(options) {
        this.messageId = 0;

        this.METHODS = {
            CONNECT: "connect",
            UPDATE: "update",
            ANSWER: "answer",
            DISCONNECT: "disconnect",
            KEEPALIVE: "keepalive",
            CANDIDATE: "candidate",
            MUTE: "mute",
            TOKEN: "token",
            INFO: "info",
            ICE: "ice"
        };

        this.TOKEN_TYPES = {
            STATUS              :  "status",
            RELEASE             :  "release",
            TOKENINDICATION     :  "tokenindication",
            CONTENTINDICATION   :  "contentindication"
        };

        this.TOKEN_STATUS = {
            GRANTED             : "granted",
            DENIED              : "denied",
            REVOKED             : "revoked",
            RELEASED            : "released",
            WAITING             : "waiting_user_confirmation", //special token status, indicates user is waiting on Chrome's Popup
            CANCELLED           : "cancelled" //special token status, to indicate user cancelled screen share from popup.
        };
    },

    generateMsgId: function () {
        return ++this.messageId;
    },

    setCallid: function(callId) {
        this.callId = callId;
    },

    getCallId: function() {
        return this.callId;
    },

    getRequestMessage: function(methodParams) {
        var requestMsg = _.extend({}, RTCBlueJay.MESSAGE_BASE,
            {"call": this.callId, "id" : this.generateMsgId()},
            methodParams);
        return requestMsg;
    },

    getConnectMessage: function(messageParams) {
        return this.getRequestMessage({ "method" : "connect", "params" : messageParams});
    },

    getUpdateMessage: function(messageParams) {
        return this.getRequestMessage({ "method" : "update", "params" : messageParams})
    },

    getMuteMessage: function(messageParams) {
        return this.getRequestMessage({"method" : "mute", "params" : messageParams});
    },

    requestTokenMsg: function() {
        return this.getRequestMessage({"method" : "token", "params" : {"type" : "request"}});
    },

    releaseTokenMsg: function() {
        return this.getRequestMessage({"method" : "token", "params" : {"type" : "release"}});
    },

    getIceCandidateMessage: function(iceCandidate) {
        return this.getRequestMessage({"method" : "ice", "params" : {"iceCandidate" : iceCandidate}});
    },

    getInfoMsg: function(messageParams) {
        return this.getRequestMessage({"method" : "info", "params" : messageParams});
    },

    getKeepaliveMessage: function() {
        return this.getRequestMessage({"method" : "keepalive", "params" : {}});
    },

    getDisconnectMessage: function(messageParams) {
        return this.getRequestMessage({"method" : "disconnect", "params" : messageParams});
    },

    getSuccessResponse: function(messageId) {
        return _.extend({},RTCBlueJay.MESSAGE_BASE,
            {"id" : messageId, "call" : this.callId, "result" : "null"});
    },

    getErrorResponse: function(messageId, errorMessage) {
        return _.extend({},RTCBlueJay.MESSAGE_BASE,
            {"id" : messageId, "call" : this.callId, "error" : errorMessage});
    }

});

module.exports = new RTCBlueJay();
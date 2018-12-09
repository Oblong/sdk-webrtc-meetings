var _           = require('underscore');
var backbone    = require('backbone');
var RTCTransactionModel = Backbone.Model.extend({
    defaults: {
        //Add default values for the tabel
        bluejayReqMap: {},
        bluejayKeepAlive : {},
        bluejayRespMap: {},
        requestCallbacks: {},
        bluejayMuteMsg: {},
        bluejayTokenMsg: {},
        connectResponseReceived: false,
        callState: 'idle'
    },

    addRequest: function(messageId, requestParams) {
        this.get('bluejayReqMap')[messageId] = requestParams;
    },

    updateRequest: function(messageId, requestParams) {
        this.get('bluejayReqMap')[messageId] = requestParams;
    },

    removeRequest: function(messageId) {
        if (this.get('bluejayReqMap')[messageId])
        {
            this.unset('bluejayReqMap'[messageId], {silent:true});
        }
    },

    addResponse: function(messageId, response) {
        this.get('bluejayRespMap')[messageId] = response;
    },

    getRequest: function(messageId) {
        return this.get('bluejayReqMap')[messageId];
    },

    getResponse: function(messageId) {
        return this.get('bluejayRespMap')[messageId];
    },

    addKeepAlive: function(msg) {
        this.set('bluejayKeepAlive', msg) ;
    },

    addMuteMessage: function(msg) {
        this.set('bluejayMuteMsg', msg);
    },

    addTokenMessage: function(msg) {
        this.set('bluejayTokenMsg', msg);
    },

    getMuteMessage: function() {
        return this.get('bluejayMuteMsg');
    },

    getTokenMessage: function() {
        return this.get('bluejayTokenMsg');
    },

    getAllRequestMsgIds: function() {
        return _.keys(this.get('bluejayReqMap'));
    },

    resetTransaction: function() {
        this.set(this.defaults, {silent: true});
    }
});

module.exports = RTCTransactionModel;

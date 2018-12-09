
/**
 * Created by nitesh on 01/09/16.
 */

var	Backbone    = require('backbone');
var _           = require('underscore');
var Participant = require('./participant');

var SORT_PREFIX_SELF = 0;
var SORT_PREFIX_MODERATOR = 1;
//var SORT_PREFIX_PRESENTER = 2;
var SORT_PREFIX = 3;
var SORT_PREFIX_NOT_ENTERED = 4;

var NAME_PLACEHOLDER = "aaa";

var ParticipantsCollection = Backbone.Collection.extend({

    model: Participant,

    initialize: function() {
        Backbone.Collection.prototype.initialize.apply(this);
        _.bindAll(this, 'getExistingForRaw');
        this.callGuidMap = {};
        this.chatGuidMap = {};
    },

    comparator : function(model) {
        // Artifically sort into moderator at the top, then self
        // then the rest of the name alphabetically.
        var prefix = SORT_PREFIX;
        prefix = model.get("isLeader") ? SORT_PREFIX_MODERATOR : prefix;
        prefix = model.get("isSelf") ? SORT_PREFIX_SELF : prefix;

        return prefix + (model.get("name") ? model.get("name").toLowerCase() : NAME_PLACEHOLDER);
    },

    sync: function(method, data, options){
        data.trigger('fetch', method, options);
    },

    getExistingForRaw: function(rawParticipant) {
        return this.get(this.model.getId(rawParticipant));
    },

    getEnteredLength: function() {
        return this.filter(function(participant) {
            return participant.isEntered();
        }).length;
    }
});

module.exports = ParticipantsCollection;

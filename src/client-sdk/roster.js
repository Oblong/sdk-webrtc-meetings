
/**
 * Created by nitesh on 01/09/16.
 * upd: 3/2018, g1
 */
var	_                      = require('underscore');
var my                     = require('myclass');
var ParticipantsCollection = require('./models/participants-collection');
var Participant            = require('./models/participant');

var Roster = my.Class({
    constructor : function(collection) {
        //_.bindAll(this);
        this.collection = collection;
        this.selfParticipant = new Participant();
    },

    /*
      * extractSelf: extractSelf from raw roster and populate this.selfParticipant
      */
    extractSelf: function(rawParticipantData) {
        var newFullSelf;
        var selfParticipantId = this.selfParticipant ? this.selfParticipant.id: null;
        if (rawParticipantData.f) {
              _(rawParticipantData.f)
                .filter(function(participant){
                    if (selfParticipantId && Participant.getId(participant) === selfParticipantId) {
                        newFullSelf = participant;
                        return false;
                    }
                    return true;
                });
            console.log("newFullself = ", newFullSelf);
            newFullSelf && this.processSelf(newFullSelf, this.selfParticipant);
        }

        var newAddSelf;
        if (rawParticipantData.a) {
              _(rawParticipantData.a)
                .filter(function(participant){
                    if (selfParticipantId && Participant.getId(participant) === selfParticipantId) {
                        newAddSelf = participant;
                        return false;
                    }
                    return true;
                });
            newAddSelf && this.processSelf(newAddSelf, this.selfParticipant);
        }

        var newModifySelf;
        if (rawParticipantData.m) {
            _(rawParticipantData.m)
                .filter(function(participant){
                    if (selfParticipantId && Participant.getId(participant) === selfParticipantId) {
                        newModifySelf = participant;
                        return false;
                    }
                    return true;
                });
            newModifySelf && this.processSelf(newModifySelf, this.selfParticipant);
        }

        if (rawParticipantData.d) {
            _(rawParticipantData.d)
                .filter(_.bind(function(participant){
                    if (selfParticipantId && Participant.getId(participant) === selfParticipantId) {
                        this.selfLeft();
                        return false;
                    }
                    return true;
                }, this));
        }
    },

    fullUpdate: function(rawParticipantData, options) {
        //Logger.debug("Full update");
        console.log("fullUpdate rawParticipantData = ", rawParticipantData);
        console.log("fullUpdate options = ", options.selfParticipant);
        var currentData = this.collection ? this.collection : new ParticipantsCollection();
        var toAdd = [], toModify = [], toDelete = [], affectedIds = [];
        this.extractSelf(rawParticipantData);

        _(rawParticipantData.f).each(function(participant){
            var existingParticipant = currentData.getExistingForRaw(participant);
            if (existingParticipant) {
                toModify.push(participant);
                affectedIds.push(existingParticipant.get('id'));
            } else {
                toAdd.push(participant);
            }
        });

        _(_.difference(_.pluck(currentData.models, 'id'), affectedIds)).each(function(id){
            toDelete.push(currentData.get(id));
        });

        //console.log("options = ", options);
        //console.log("toAdd = ", toAdd);
        //console.log("toModify = ", toModify);
        //console.log("toDelete = ", toDelete);
        this.processAdded(toAdd, options);
        this.processModified(toModify, options);
        this.processDeleted(toDelete, options, true);
    },

    partialUpdate: function(rawParticipantData, options) {

        this.extractSelf(rawParticipantData);
        rawParticipantData.a && this.processAdded(rawParticipantData.a, options);
        rawParticipantData.m && this.processModified(rawParticipantData.m, options);
        rawParticipantData.d && this.processDeleted(rawParticipantData.d, options);

    },


    processAdded: function(rawParticipantData, options) {
        var currentData = this.collection;
        var toAdds = _(rawParticipantData)
            .map(_.bind(function(rawParticipantDatum) {
                var translatedParticipantDatum = currentData.model.translateAttributes(rawParticipantDatum, undefined);
                return new currentData.model(translatedParticipantDatum);
            }, this))
            .filter(function(participant){
                return participant.get('isVisible');
            });

        _.each(toAdds, function(participant){
            //Logger.debug("Roster Stream: Adding participant " + participant.get('id'));
            currentData.add(participant, options);
            //if(features.private_chat) {
            //    hammerloop.publish(hammerloop.skinny.meeting.chat.setUserOnline, participant.get('chatEndpointGuid'));
            //}
        });
    },

processModified: function(peopleToUpdate, options) {
  // Modified
  var participants = this.collection;

  // scan through all the people to update,
  //   and for each person, scan through all elements in update
  //  	and copy each updated field into existing participant
  var toChanges = _(peopleToUpdate).map(function(updatedField) {
    return participants.model.translateAttributes(updatedField,
      participants.getExistingForRaw(updatedField));

    }).value();

  // scan through the change list, and set each affected participant
  _.each(toChanges, function(changedParticipant){
    var toModify = participants.get(changedParticipant.id);
    if (toModify) {
      toModify.set(changedParticipant);
    }
  });
    },

    processDeleted: function(rawParticipantData, options, useId) {
        // Deleted
        var currentData = this.collection;
        _(rawParticipantData)
            .each(function(participantOrId){
                var toDelete = useId ? currentData.get(participantOrId) : currentData.getExistingForRaw(participantOrId);
                if (toDelete) {
                    //Logger.debug("Roster Stream: Deleting participant " + toDelete.get('id'));

                    toDelete.destroy();
                }
                else {
                    //Logger.warn("Roster Stream: Could not delete participant " + JSON.stringify(participantOrId));
                }
            });
    },

    assignedSelf: function(guidAssignedMsg) {
        var currentData = this.collection;
        // Check if the roster has self entry
        var newAddSelf;
        this.selfParticipant.id = guidAssignedMsg.E1;
        if (currentData) {
            console.log("currData = ", currentData);
            currentData = _(currentData)
                .filter(function(participant){
                    console.log("participant = ", participant);
                    if (!participant) {
                        return false;
                    }
                    if (guidAssignedMsg && guidAssignedMsg.E1 && participant.id === guidAssignedMsg.E1) {
                        newAddSelf = participant;
                        return false;
                    }
                    return true;
                });
            if (newAddSelf) {
                this.processSelf(newAddSelf);
            } else {
                Participant.translateAttributes(guidAssignedMsg, this.selfParticipant);
            }
        }

    },

    processSelf: function(newObj, oldSelf) {
        //Logger.debug("Processing self participant: " + JSON.stringify(newObj));
        if (newObj !== undefined) {

            var oldObj = oldSelf ? oldSelf: new Participant();

            // console.log("objObj = ", oldObj);
            var selfAttributes = this.collection.model.translateAttributes(
                newObj, oldObj);

            // Update self participantsListItem with new info
            oldObj.set(selfAttributes);
        }
    },

    selfLeft: function() {
        //cofa.skinny.selfIsLive = false;
        ////Logger.info("Detected that self left");
        //if (!cofa.skinny.isBrowser) {
        //    hammerloop.publish(hammerloop.skinny.ui.mediaLeft);
        //} else {
        //    hammerloop.publish(hammerloop.skinny.ui.nonBrowserScreen, "hide");
        //    hammerloop.publish(hammerloop.skinny.ui.noVideoScreen, "permahide");
        //}
    },

    registerMeetingEventsProcessor: function (meetingEventsProcessor) {
        var currentData = this.collection ? this.collection : new ParticipantsCollection();
        this.meetingEventsProcessor = meetingEventsProcessor;

        var self = this;
        _.defer(function() {
            self.meetingEventsProcessor.processFullRoster(currentData);
        });
    }
});

module.exports = Roster;

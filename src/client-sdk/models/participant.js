/**
 * Created by nitesh on 30/08/16.
 */
var Backbone   = require('backbone');
var _          = require('underscore');
var Connection = require('./connection');

var Participant = Backbone.Model.extend({
    defaults: {
        isPinned: false,
        unreadMessages: 0,
        isOpenedChat: false
    },

    collectionProps: {"connections": Connection.Collection},

    sync: function(method, data, options) {
    },

    destroy: function(options){
        Backbone.Model.prototype.destroy.call(this, options);
    },

    set: function(key, value, options) {
        var self = this;

        var updateCollection = function(attrs) {
            return _.object(_.map(attrs, function(value, prop) {
                if (!self.collectionProps[prop]) {
                    return [prop, value];
                }

                if (value instanceof Backbone.Collection) {
                    return [prop, value];
                }

                var collection = self.get(prop);

                collection.set(value);
                return [prop, collection];
            }));

        };

        var initializeCollections = function() {

            return _.object(_.map(self.collectionProps, function(collectionClass, collectionProp) {
                return [collectionProp, new (collectionClass)()];
            }));
        };

        var attrsToProcess;
        if (typeof key === 'object') {
            if (!this._collectionsInitialized) {
                Backbone.Model.prototype.set.call(self, initializeCollections(), options);
                this._collectionsInitialized = true;
            }

            var attrs = key;
            options = value;

            attrsToProcess = updateCollection(attrs);

            Backbone.Model.prototype.set.call(self, attrsToProcess, options);

        }
        else {
            attrsToProcess = updateCollection(_.object([key], [value]));
            if (attrsToProcess[key] !== undefined) {
                Backbone.Model.prototype.set.call(self, key, value, options);
            }
        }


    },

    isEntered: function() {
        var hasSkinny = _.any(this.get("connections").toJSON(), function(connection) {
            return connection.endpoint == "Skinny";
        });

        if (hasSkinny) {
            return _.any(this.get("connections").toJSON(), function(connection) {
                return connection.capabilities.length > 0;
            });
        }
        else {
            return true;
        }
    }

}, {
    translationMatrixShort: function(dataObject, selfParticipant) {
        return {
            dataObject              : dataObject,
            chatEndpointGuid        : dataObject.ch,
            callguid				: dataObject.c,
            id                      : dataObject.E1,
            name                    : dataObject.n,
            type                    : dataObject.t || "endpoint",
            callQuality             : parseInt(dataObject.C1, 10),
            isLeader                : dataObject.L1 == 1,
            isSelf                  : selfParticipant && dataObject.E1 == selfParticipant.id,
            endpointType            : dataObject.e,
            isSpeaking              : dataObject.T == "1",
            isPresenting            : dataObject.C2 == "1",
            isSecure                : dataObject.e == "Freeswitch" || dataObject.e == "Phone" || dataObject.e == "PartnerParticipant" || dataObject.S1 == "1",
            isPhone                 : dataObject.e == "Phone" || dataObject.e == "PartnerParticipant",
            meetingId               : dataObject.m,
            isVisible               : !dataObject.v || dataObject.v == "1",
            isChatOnly				: dataObject.e == "SkinnyChat",

            inWaitingRoom           : !dataObject.L2 || dataObject.L2 == "1",
            isPresentationLayout    : dataObject.L2 == "2",
            isVideoLayout           : dataObject.L2 == "4",
            currentLayout           : dataObject.S2,

            isCurrentlyShowingVideo : dataObject.V1 == "1",
            isSendingVideo          : dataObject.V2 != "1",
            isServerMutingVideo     : dataObject.V3 == "1",
            isVideoSeen             : dataObject.V2 != "1" && dataObject.V3 != "1",

            isCurrentlyShowingAudio : dataObject.A1 == "1",
            isSendingAudio          : dataObject.A2 != "1",
            isServerMutingAudio     : dataObject.A3 == "1",
            isAudioHeard            : dataObject.A2 != "1" && dataObject.A3 != "1",

            alerts                  : (dataObject.a ? dataObject.a.split(",") : undefined),

            audioRecvCodec          : (dataObject.A4 !== undefined &&
            dataObject.A4 !== '' ? dataObject.A4 : null),
            audioSendCodec          : (dataObject.A5 !== undefined &&
            dataObject.A5 !== '' ? dataObject.A5 : null),

            videoRecvCodec          : (dataObject.V4 !== undefined &&
            dataObject.V4 !== '' ? dataObject.V4 : null),
            videoRecvHeight         : (dataObject.V5 &&
            dataObject.V5 !== '' ?	parseInt(dataObject.V5, 10) : null),
            videoRecvWidth          : (dataObject.V6 &&
            dataObject.V6 !== '' ? parseInt(dataObject.V6, 10) : null),

            videoSendCodec          : (dataObject.V7 !== undefined &&
            dataObject.V7 !== '' ? dataObject.V7 : null),
            videoSendHeight         : (dataObject.V8 &&
            dataObject.V8 !== '' ? parseInt(dataObject.V8, 10) : null),
            videoSendWidth          : (dataObject.V9 &&
            dataObject.V9 !== '' ? parseInt(dataObject.V9, 10) : null),

            contentRecvHeight       : (dataObject.C3 &&
            dataObject.C3 !== '' ? parseInt(dataObject.C3, 10) : null),
            contentRecvWidth        : (dataObject.C4 &&
            dataObject.C4 !== '' ? parseInt(dataObject.C4, 10) : null),

            // These are stubs. We need to co-ordinate with denim and seam teams to get these events
            videoShareRecvHeight    : (dataObject.VideoShareRecvHeight &&
            dataObject.VideoShareRecvHeight !== '' ? parseInt(dataObject.VideoShareRecvHeight, 10) : null),
            videoShareRecvWidth     : (dataObject.VideoShareRecvWidth &&
            dataObject.VideoShareRecvWidth !== '' ? parseInt(dataObject.VideoShareRecvWidth, 10) : null),

            pinnedGuid              : dataObject.P1,
            connections             : dataObject.C5 ? _.map(dataObject.C5, function(connection) { return Connection.translationMatrix(connection); }) : null,
            rdcControllee           : (dataObject.r !== undefined &&
            dataObject.r !== 'None' ? dataObject.r : null),
            rdcVersion              : dataObject.R1,
            isRdcControllerCapable  : dataObject.R2 == "1",
            isRdcControlleeCapable  : dataObject.R3 == "1"

        };
    },


    translateAttributes: function(rawAttributes, currentModel) {
        // Translate object
        var currentObj = currentModel && currentModel.get('dataObject') ? currentModel.get('dataObject') : {};
        var mergedObj = _.extend(currentObj, rawAttributes);
        if (currentModel && currentModel.get('id')) {
            mergedObj.id = currentModel.get('id');
        }
        var newData = this.translationMatrixShort(mergedObj, currentModel);
        return newData;
    },

    getId: function(rawAttributes) {
        return rawAttributes.E1;
    }
});

module.exports = Participant;

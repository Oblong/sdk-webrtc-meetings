var Backbone            = require('backbone');
var $                   = require('jquery');
var _                   = require('underscore');
var Logger              = require('Logger');
var RTCStates           = require('./rtc-states');

var RTCScreenSharingModel = Backbone.Model.extend({

    defaults: {
        "localContentStream"            : null,
        "chromeMediaSourceId"           : null,
        "isChromeExtensionInstalled"    : false,
        "extensionStatus"               : RTCStates.EXTENSION_STATES.NOT_INSTALLED,
        "screenShareState"              : null,
        "tokenStatus"                   : null,
        "presentationToken"             : {},
        "firefoxScreenShareCancelled"   : null
    },

    isExtensionInstalled: function () {
        var extensionDom = $('body').find('.InMeetingExtensionIsInstalled');
        var extensionDomInserted = false;
        var self = this;

        _.each(extensionDom, function(el, index, list) {
            if($(el).attr('data-extension-id') === self.get('extensionId')) {
                extensionDomInserted = true;
            }
        });

        var alreadyInstalled = (this.get('extensionStatus') === RTCStates.EXTENSION_STATES.INSTALLED);

        if (extensionDomInserted || alreadyInstalled) {
            Logger.debug("RTCScreenSharingModel: The Screen Sharing Chrome extension has been installed.");
            return true;
        }
        Logger.warn("RTCScreenSharingModel: The Screen Sharing Chrome extension is not installed.");
        return false;
    },

    isExtensionInstalling: function() {
        return (this.model.get('extensionStatus') === RTCStates.EXTENSION_STATES.INSTALLING);
    }
});

module.exports = RTCScreenSharingModel;

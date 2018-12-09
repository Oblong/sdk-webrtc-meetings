var Backbone      = require('backbone');
var _             = require('underscore');

var Connection = Backbone.Model.extend({
  idAttribute: "connectionGuid"
}, {
  translationMatrix: function(dataObject) {
    var result = _.clone(dataObject);
    if (result.capabilities) {
      result.capabilities = _.map(result.capabilities, function(capability) {
        return capability.toLowerCase();
      });
    }
    return result;
  }
});

Connection.Collection = Backbone.Collection.extend({
  model: Connection
});

module.exports = Connection;
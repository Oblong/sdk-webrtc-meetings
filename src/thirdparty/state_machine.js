  var lodash = require('lodash');

  function assert(condition, message) {
      if (!condition) {
          throw message || "Assertion failed";
      }
  }

  var transitionCallback = function (options, callback) {
      return {
          call: function (from, to) {
              if ((options.from === undefined || options.from === from) && (options.to === undefined || options.to === to)) {
                  callback({from:from, to:to});
              }
          }
      }
  };

  var transitions = {
      transition: function (options) {

          return function (stateMachine, updateState) {
              var applicableOption = Array.isArray(options) ? lodash.find(options, function (option) {
                  return option.from == stateMachine.getState();
              }) : options;

              if (applicableOption && applicableOption.from !== undefined) {
                  if (stateMachine.getState() == applicableOption.from || lodash.include(applicableOption.from, stateMachine.getState())) {
                      updateState(stateMachine.getState(), applicableOption.to, applicableOption.resetTriggers);
                      return true;
                  }
              }
          };
      },
      afterTransition: function (options, callback) {
          return lodash.extend(transitionCallback(options, callback), {beforeTransition: false});
      },
      beforeTransition: function (options, callback) {
          return lodash.extend(transitionCallback(options, callback), {beforeTransition: true});
      }
  };


  var triggers = {
      anyOf: function (triggers) {
          return {
              isFulfilled: function (activatedTriggers) {
                  return !lodash.isEmpty(this.matchingTriggers(activatedTriggers));
              },
              matchingTriggers: function (activatedTriggers) {
                  return lodash.intersection(triggers, activatedTriggers);
              }
          }
      },
      allOf: function (triggers) {
          return {
              isFulfilled: function (activatedTriggers) {
                  return lodash.isEmpty(lodash.difference(this.matchingTriggers(activatedTriggers), activatedTriggers));
              },
              matchingTriggers: function () {
                  return triggers;
              }
          }
      }
  };

  var createStateMachine = function (options) {
      assert(options.initial !== undefined, "initial state is mandatory");
      var stateMachine = {};
      stateMachine.events = options.events;
      stateMachine.triggers = options.triggers;
      stateMachine.callbacks = options.callbacks;

      var stateMachinePrivateState = {state: options.initial, activatedTriggers: []};

      function fireCallbacks(callbacks, from, to) {
          if (callbacks) {
              lodash.each(callbacks, function (callback) {
                  callback.call(from, to);
              });
          }
      }

  var updateState = function (from, to, resetTriggers) {
          var callbacks = lodash.groupBy(stateMachine.callbacks, function (callback) {
              return callback.beforeTransition === true;
          });
          var beforeCallbacks = callbacks[true];
          if(beforeCallbacks) {
              fireCallbacks(beforeCallbacks, from, to);
          }
          stateMachinePrivateState.state = to;
          var afterCallbacks = callbacks[false];
          if(afterCallbacks) {
              fireCallbacks(afterCallbacks, from, to);
          }
          if (resetTriggers === true) {
              stateMachinePrivateState.activatedTriggers = [];
          }
      };

      stateMachine.getState = function () {
          return stateMachinePrivateState.state;
      };


      lodash.each(lodash.keys(stateMachine.events), function (eventName) {
          var eventTransition = options.events[eventName];
          assert(eventTransition !== undefined);
          stateMachine[eventName] = function () {
              return eventTransition(stateMachine, updateState);
          }
      });

      function processTriggers() {
          var fulfilledActivatedTriggers = {};
          lodash.each(stateMachine.triggers, function (trigger) {
              var fulfilled = trigger.activatedBy.isFulfilled(stateMachinePrivateState.activatedTriggers);
              if (fulfilled) {
                  if (stateMachine[trigger.event]()) {
                      var matchingTriggers = trigger.activatedBy.matchingTriggers(stateMachinePrivateState.activatedTriggers);
                      stateMachinePrivateState.activatedTriggers = lodash.difference(stateMachinePrivateState.activatedTriggers, matchingTriggers);
                  }
              }
          });
      }

      stateMachine.trigger = function (triggerName) {
          stateMachinePrivateState.activatedTriggers.push(triggerName);
          processTriggers();
      };

      return stateMachine;
  };

//noinspection JSUnresolvedVariable
  module.exports = {
      create: createStateMachine,
      transitions: transitions,
      triggers: triggers
  };
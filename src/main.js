import PromiseQueue from 'promise-queue-observable'
import Immutable from 'seamless-immutable'

import logger from './utils/logger'
import parseUri from './utils/parseUri'

import FirebaseListeners from './utils/context'

const $log = Symbol('firebase_$logger')
const $onEvent     = Symbol('firebase_$on')
const $onError = Symbol('firebase_$error')
const $onCancel = Symbol('firebase_$cancel')

const buildConfig = config => ({
  // do we want to first rehydrate the value before creating the listeners?
  rehydrate: true,
  // true for logging, 'detailed' for inclusion of children information
  // in the logs.
  log: false,
  // set to console.group to have it default to opened logs
  logger: console.groupCollapsed,
  // icon to include with the logs
  icon: '🔥',
  // default promise implementation to use
  promise: Promise,
  // factory to allow modifying any created promises
  promiseFactory: undefined,
  // PromiseQueue style ? 'next' or 'shift'
  // https://github.com/Dash-OS/promise-queue-observable
  queueStyle: 'next',
  // Do we want every event to be reported?
  // an array of events 
  // 'changed', 'removed', 'added', 'off', 'cancelled', 'complete'
  notifyOn: [ 'changed', 'off', 'cancelled' ],
  // a function to be called in the case any error occurs internally
  onError: undefined,
  ...config,
})

const onMaybeUpdateClient = function onFirebaseMaybeUpdateClient(
  schema, 
  change_event, 
  value_changed, 
  snapshot
) {
  /*  When a value changes then we will publish to the observer
      so any observers can capture the value(s). We return a
      mutable copy of the data.
  */
  if ( 
    this.config.notifyOn.includes(change_event)
    || ( this.config.notifyOn.includes('changed') && value_changed )
    || this.config.notifyOn.includes('all')
  ) {
    try {
      this.observer.publish(
        change_event,
        Immutable.asMutable(this.state.value, { deep: true }),
        schema
      )
    } catch (e) {
      this[$log](() => [
        'While Updating Client', 
        e.message, 
        `Event: ${change_event}`, 
        schema,
        e, 
        ['color: darkred']
      ], undefined)
      const shouldThrow = this[$onError](e, { on: 'update-client' })
      if ( shouldThrow !== false ) {
        throw e
      }
    }
  }
  
}

const onSnapshot = function onFirebaseSnapshot(method, event, snapshot) {
  /* When we receive data from a firebase listener we need to parse it
     and determine if an update to the UI is warranted.  For this reason
     we use immutable data structure to store our data.
  */
  const value = snapshot.val()
  const key = snapshot.key
  let current_value = this.state.value
  let new_value
  let change_event

  if ( ! current_value && typeof value === 'object' ) {
    if ( Array.isArray(value) ) {
      current_value = Immutable([])
    } else {
      current_value = Immutable({})
    }
  }

  if ( value === null ) {
    // data is no longer available!
    change_event = 'removed'
    new_value = undefined
  } else {
    switch(event) {
      case 'rehydrate': {
        change_event = 'rehydrated'
        new_value = Immutable.replace(current_value, value, { deep: true })
        break
      }
      case 'value': {
        change_event = 'changed'
        new_value = Immutable.replace(current_value, value, { deep: true })
        break
      }
      case 'child_added': {
        // child_added may not indicate that a new child has been added.  we
        // use deep compare here to make sure the actual value changed before
        // triggering a callback.
        change_event = 'added'
        new_value = Immutable.set(current_value, key, value, { deep: true })
        break
      }
      case 'child_removed': {
        change_event = 'removed'
        new_value = Immutable.without(current_value, key)
        break
      }
      case 'child_changed': {
        // we dont use deep compare during change as we know that the value
        // has changed.
        change_event = 'changed'
        new_value = Immutable.set(current_value, key, value)
        break
      }
    }
  }

  this.state.value = new_value
  const value_changed = current_value !== new_value

  this[$log](() => [
    event, key, value, [`color: ${value_changed ? 'darkgreen' : 'black'}`]
  ], snapshot)
  
  return onMaybeUpdateClient.call(
    this, 
    { method, event, key, value }, 
    change_event, 
    value_changed,
    snapshot
  )
}

const setupListenerOnEvent = function onFirebaseListenToEvent(_event) {
  let method = 'on', event = _event
  if ( event === 'once') {
    method = 'once'
    event = 'value'
    this.state.events.delete(_event)
  }
  if ( this.state.listeners[event] ) {
    // we already have a listener for this event
    return
  }
  const id = this.ref[method](
    event,
    s => { this[$onEvent](method, event, s) },
    this[$onCancel]
  )

  if (method !== 'once') {
    this.state.listeners[event] = id
    if ( ! this.state.events.has(event) ) this.state.events.add(event)
  }
}

const listenToInitialEvents = function onFirebaseInitializeEvents(events) {
  this.state.initializer = this.ref.on('value', snapshot => {
    if ( this.state.rehydrated ) {
      // if we are rehydrated and we originally requested the value
      // event then we forward it to the $onEvent handler.
      return this[$onEvent]('on', 'value', snapshot)
    } else {
      // once we receive the value we will add it then build our children
      // listeners
      this[$onEvent]('on', 'rehydrate', snapshot)

      this.state.rehydrated = true

      if ( events.has('value') ) {
        // if we have a value property then we do not need to cancel
        // the property, instead we will transfer the intializer into
        // our listeners
        this.state.listeners.value = this.state.initializer
      }

      // setup the original listeners now that we are rehydrated
      listenToEvents.call(this, events)

      if ( ! events.has('value') ) {
        this.ref.off('value', this.state.initializer)
      }

      delete this.state.initializer
    }
  }, this[$onCancel])
}

const listenToEvents = function onFirebaseListenToEvents(events) {
  const awaitRehydration =
       this.config.rehydrate
    && ! this.state.rehydrated

  if ( awaitRehydration ) {
    return listenToInitialEvents.call(this, events)
  } else {
    return events.forEach(_event => setupListenerOnEvent.call(this, _event))
  }
}

const cancelEvents = function onFirebaseCancelEvents(events) {
  let cancelledEvents = []
  let handlingEvent = undefined
  try {
    events.forEach(event => {
      handlingEvent = event
      if ( this.state.listeners[event] ) {
        const listenerID = this.state.listeners[event]

        this.ref.off(event, listenerID)

        delete this.state.listeners[event]
        this.state.events.delete(event)

        cancelledEvents.push(event)
      }
    })
    if ( cancelledEvents.length > 0 && ! this.observer.isCancelled ) {
      onMaybeUpdateClient.call(this, { cancelledEvents }, 'off', false)
    }
  } catch (e) {
    this[$log](() => [
      `While Cancelling Event ${handlingEvent || ''}`, 
      e.message, 
      handlingEvent, 
      e, 
      ['color: darkred']
    ], undefined)
    const shouldThrow = this[$onError](e, { on: 'cancel-event', handlingEvent })
    if ( shouldThrow !== false ) {
      throw e
    }
  }
}

const onCancel = function onFirebaseCancellation(...args) {
  this.observable.cancel()
  this.cancel()
}

// If we have a .next promise, move it to .current, otherwise
// otherwise .current will become undefined for the next caller
const shiftQueue = function onFirebaseQueueShift() {
  this.state.promises.current = this.state.promises.next
  delete this.state.promises.next
}

const resolveNext = function onFirebaseResolveNext(after) {
  const promise = new this.config.promise((resolve, reject) => {
    let promise, firstListener
    if ( ! this.state.promises.current ) {
      this.state.promises.current = this.observer.next()
      promise = this.state.promises.current
      firstListener = true
    } else if ( ! after ) {
      promise = this.state.promises.current
    } else {
      // requesting the change after the next
      if ( this.state.promises.next ) {
        promise = this.state.promises.next
      } else {
        this.state.promises.next = this.observer.next()
        promise = this.state.promises.next
      }
    }
    return promise.then(r => {
      if ( firstListener ) { shiftQueue.call(this) }
      return resolve(r)
    })
  })
  if ( this.config.promiseFactory ) {
    return this.config.promiseFactory.call(this, promise)
  } else { return promise }
}

class FirebaseListener {

  constructor(ref, config, url) {
    this.ref = ref
    this.url = url
    const uri = parseUri(url)
    this.host = uri.host
    this.name = uri.path

    this.config = buildConfig(config)
    
    if ( typeof this.config.notifyOn === 'string' ) {
      this.config.notifyOn = [ this.config.notifyOn ]
    }
    
    this.state = {
      // have we rehydrated the ref?
      rehydrated: false,
      // used by the rehydrater
      initializer: undefined,
      // active listeners and their cancellation fn
      listeners: {},
      // what events are currently setup?
      events: [],
      // will be an immutable data structure if we receive an object
      // as a value.
      value: undefined,
      promises: {
        // the next changes promise to allow multiple listeners to get
        // the next update.
        current: undefined,
        // the change after the nexts promise.
        next: undefined
      }
    }

    this[$onEvent] = onSnapshot.bind(this)
    this[$onCancel] = onCancel.bind(this)
    this[$log] = this.config.log ? logger.bind(this) : () => {}
    this[$onError] = this.config.onError ? this.config.onError.bind(this) : () => {}
    this.isCancelled = false
    
    // the observer which we use to resolve changes to listeners
    this.observer = new PromiseQueue({ 
      name: this.name,
      queueStyle: this.config.queueStyle || 'next',
    })

    this.config.log && this[$log](() => [
      'New FirebaseListener Created!', this.name, ['color: darkorange']
    ], undefined)

    FirebaseListeners.set(url, this)
  }

  next = (after = false) => resolveNext.call(this, after)

  value = (mutable = true) => (
    mutable
      ? Immutable.asMutable(this.state.value, { deep: true })
      : this.state.value
  )
  
  events = (_events, ...args) => {
    const events = Array.isArray(_events) && _events || [ _events ]
    this.state.events = new Set([...events, ...args])
    return this
  }

  listen = _events => {
    let events = _events
    try {
      if ( this.isCancelled ) {
        throw new Error('This listener has been cancelled but you tried to listen to it.')
      }
      if ( ! events ) events = this.state.events
      if ( ! events ) { return } else if ( ! events instanceof Set ) {
        // we use sets for unique values and to have .has() checks
        events = new Set([...this.state.events, ...events])
      }
      if ( events.has('once') ) {
        // If once is within the events we want it to be at the end.  It will 
        // still be placed the first response.  This style should not be required 
        // unless rehydrate is set to true in configuration.
        events.delete('once')
        events.add('once')
      }
      this.state.events = events
      listenToEvents.call(this, events)
    } catch (e) { 
      const shouldThrow = this[$onError](e, { on: 'listen', events })
      if ( shouldThrow !== false ) {
        throw e
      }
    }
    return this
  }
  
  cancelled = () => this.isCancelled || this.observer.cancelled()

  cancel = () => {
    try {
      this.isCancelled = true
      this.off()
      this.observer.cancel()
      FirebaseListeners.delete(this.url)
      if ( ! this.observer.isCancelled ) {
        onMaybeUpdateClient.call(this, {}, 'cancelled')
      }
    } catch (e) {
      const shouldThrow = this[$onError](e, { on: 'cancel' })
      if ( shouldThrow !== false ) {
        throw e
      }
    }
    return this.observer.cancelled()
  }

  off = _events => {
    let events = _events
    if ( ! events ) { events = this.state.events }
    cancelEvents.call(this, events)
    return this
  }

}

const cancelAllFirebaseListeners = function onFirebaseKillAllListeners() {
  for ( let [ url, listener ] of FirebaseListeners ) {
    listener.cancel()
  }
}

/* Our Factory will parse the created listeners and attempt to discover what should
   be done.
*/
const createFirebaseListener = function onFirebaseCreateNewListener(ref, config) {
  const url = ref.toString()
  if ( FirebaseListeners.has(url) ) {
    return FirebaseListeners.get(url)
  } else {
    const listener = new FirebaseListener(ref, config, url)
    return listener
  }
}

const getActiveFirebasePaths = function onFirebaseRetrieveActivePaths() {
  return [...FirebaseListeners.keys()]
}

export { createFirebaseListener, cancelAllFirebaseListeners, getActiveFirebasePaths }
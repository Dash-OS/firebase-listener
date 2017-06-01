# firebase-listener

A Utility to assist in the setup and management of your Firebase Refs.  Assists with 
managing various paths of your database and their events.  Assists with common patterns 
to provide a refreshing developer experience.

We utility [seamless-immutable](https://github.com/rtfeldman/seamless-immutable) to manage 
and detect changes to your refs events so that we can notify you.

Updates are provided using a [PromiseQueue](https://github.com/Dash-OS/promise-queue-observable) 
which allows for simple integration with many 3rd party libraries.

> This was designed to make using Firebase with [redux-saga](https://github.com/redux-saga/redux-saga) 
> a better experience during our development.

> **Important:** This is NOT stable at this time.

### What About Writing to Firebase?

We use Firebase as a top-down approach - similar to [redux](http://redux.js.org/) 
in many ways.  Our app never directly modifies the firebase.  Instead, we dispatch 
actions to [AWS Lambda](https://aws.amazon.com/lambda/) which then "reduces" the event 
and updates our database(s) accordingly.  

You can still use the ref to update directly if needed.  Since switching to the model 
described above, things have become much more streamlined and easier to handle.

### Saga Example 

Below is a simple example of a saga from [redux-saga](https://github.com/redux-saga/redux-saga) 
using this package to listen to a path.

```js
import { createFirebaseListener } from 'firebase-listener'

function* handleFirebaseReady(ref) {
  let listener
  try {
    listener = createFirebaseListener(ref, {
      // automatically registers value listener, gets the data, rehydrates with 
      // the entire contents, then removes it. this helps so your UI doesn't receive 
      // tons of child_added events needlessly.
      rehydrate: true,
      // turn on detailed logs
      log: 'detailed',
    }).events('child_added', 'child_removed', 'child_changed').listen()

    while(true) {
      // next gets the promise that will resolve with the next event that occurs.
      const event = yield call([ this.state.listener, this.state.listener.next ])
      yield fork([this, handleFirebaseEvent], event)
    }
  } catch (e) {
    // handle error
  } finally {
    // cancel the listener? once cancelled, the listener will no longer allow 
    // any calls to next()
    listener.cancel()
  }
}
```

### Batched Paths

If you setup many listeners on a single path throughout your app, this module will only 
end up registering a single listener. At this time it does not allow different parts of 
the app to setup different events for a given listener.  

> Setting up a listener on a path that was registered elsewhere includes the listener that 
> was already created. 

### Logging Events

One of the things that has always been an issue is logging the various events 
that occur with the firebase.  We wanted a way to really introspect our listeners 
and events.  

Logging is enabled by adding the `log` parameter when setting up your listener.  It 
accepts the values of `true`, `false` or `'detailed'`.  

When `'detailed'` is specified, extra information will be added to each log.  At this 
time if the log includes a `snapshot` value (events) then it will include the number of 
children.  It will also include the events currently registered on the given listener.

##### General Events are Orange

![Firebase Listener Logging](http://i.imgur.com/w5Mfgrp.png)

##### Change Events are Green

![Firebase Rehydrate Event](http://i.imgur.com/g4iXsQl.png)

##### Other Events / Logs are Black

![Firebase Event](http://i.imgur.com/V1aEHOo.png)
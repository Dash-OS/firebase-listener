export default function(...args) {
  if ( typeof args[0] === 'function' ) {
    return handleFirebaseListenerLog.call(this, ...args[0](), ...args.slice(1) || null)
  } else { return handleFirebaseListenerLog.call(this, ...args) }
}

const titlestyles = ['font-size: 13px']

const withStyles = styles => [...titlestyles , ...styles].join(';')

function handleFirebaseListenerLog(...args) {
  let snapshot = args.pop()
  let styles = []
  if ( Array.isArray(snapshot) ) {
    styles = snapshot
    snapshot = undefined
  } else {
    if ( args.length > 1 && Array.isArray(args[args.length - 1]) ) {
      styles = args.pop()
    }
  }

  this.config.logger('%c%s', withStyles(styles), `${this.config.icon || ''} [firebase-listener] ${this.config.icon || ''} | ${args.shift()} | ${args.shift()} `)
  for ( let entry of args || [] ) {
    console.info(entry)
  }

  if ( snapshot && this.config.log === 'detailed' ) {
    console.groupCollapsed('Listener Information')
      console.info('Event Listeners: ', [ ...this.state.events ])
      console.info('Has Children: ', snapshot.hasChildren())
      console.info('Total Children: ', snapshot.numChildren())
    console.groupEnd()
  }

  console.log('%c%s',
    'font-weight: bold;',
    'Listener Host: ',
    this.host
  )
  console.log('%c%s',
    'font-weight: bold;',
    'Listener Path: ',
    this.name
  )
  console.groupEnd()
}

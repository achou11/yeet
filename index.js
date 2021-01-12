const stack = []
const templates = new WeakMap()
const events = new WeakMap()
const cache = new WeakMap()
const refs = new WeakMap()

const TAG = /<[a-z-]+ [^>]+$/i
const LEADING_WHITESPACE = /^\s+(<)/
const TRAILING_WHITESPACE = /(>)\s+$/
const ATTRIBUTE = /<[a-z-]+[^>]*?\s+(([^\t\n\f "'>/=]+)=("|')?)?$/i
const PLACEHOLDER = /(?:data-)?__placeholder(\d+)__/
const PLACEHOLDERS = /(?:data-)?__placeholder(\d+)__/g
const TEXT_NODE = 3
const COMMENT_NODE = 8
const ELEMENT_NODE = 1
const FRAGMENT_NODE = 11
const AFTER_UNMOUNT = 1
const AFTER_UPDATE = 2
const AFTER_RENDER = 3

const { isArray, from: toArray } = Array
const {
  entries,
  assign,
  keys
} = Object

/**
 * Create HTML partial
 * @export
 * @param {string[]} strings Template literal strings
 * @param {...any} values Template literal values
 * @returns {Partial}
 */
export function html (strings, ...values) {
  return new Partial({ strings, values })
}

/**
 * Create SVG partial
 * @export
 * @param {string[]} strings Template literal strings
 * @param {...any} values Template literal values
 * @returns {Partial}
 */
export function svg (strings, ...values) {
  return new Partial({ strings, values, isSVG: true })
}

/**
 * Register a store function to be used for current component context
 * @export
 * @param {function} fn Store function
 */
export function use (fn) {
  const ctx = stack[0]
  fn(ctx.state, ctx.emitter)
}

/**
 * Create element reference
 * @export
 * @returns {Ref}
 */
export function ref () {
  return new Ref()
}

/**
 * Mount partial onto DOM node
 * @param {Partial} partial The partial to mount
 * @param {Node} node Any compatible node
 * @param {Object} [state] Root state
 * @returns {Node}
 */
export function mount (partial, node, state = {}) {
  const { key } = partial
  let ctx = cache.get(node)
  if (ctx?.key !== key) {
    ctx = new Context(key, state)
    if (partial instanceof Component) {
      partial = unwrap(partial, ctx)
    }
    node = render(partial.template, ctx, node)
  }
  ctx.update(partial.values)
  cache.set(node, ctx)
  return node
}

/**
 * Render template, optionally canibalizing an existing node
 * @param {Node} template The desired result
 * @param {Context} ctx The current node context
 * @param {Node} [node] An existing element to be updated
 * @returns {Node}
 */
function render (template, ctx, node) {
  if (!node) {
    node = template.cloneNode()
  } else if (events.has(node)) {
    events.get(node).clear()
  }

  const { nodeType } = node

  if (nodeType === TEXT_NODE) {
    node.nodeValue = template.nodeValue
    return node
  }

  if (nodeType === COMMENT_NODE) {
    const { nodeValue } = node
    if (PLACEHOLDER.test(nodeValue)) return new Placeholder()
    return node
  }

  if (nodeType === ELEMENT_NODE && template.nodeType === ELEMENT_NODE) {
    const placeholders = []
    const fixed = []

    for (const { name, value } of template.attributes) {
      if (PLACEHOLDER.test(name)) {
        node.removeAttribute(name)
        placeholders.push({ name, value })
      } else if (PLACEHOLDER.test(value)) {
        placeholders.push({ name, value })
      } else {
        fixed.push(name)
      }
    }

    for (const name of fixed) {
      node.setAttribute(name, template.getAttribute(name))
    }

    if (placeholders.length) {
      ctx.editors.push(function editAttributes (values) {
        const attrs = placeholders.reduce(function (attrs, { name, value }) {
          name = resolveValue(name)
          value = resolveValue(value)
          if (isArray(value)) {
            attrs[name] = value.join(' ')
          } else if (typeof name === 'object') {
            if (isArray(name)) {
              for (const value of name.flat()) {
                if (typeof value === 'object') assign(attrs, value)
                else attrs[value] = ''
              }
            } else {
              assign(attrs, name)
            }
          } else if (name.indexOf('on') === 0) {
            const events = new EventHandler(node)
            events.set(name, value)
          } else if (name === 'ref') {
            if (typeof value === 'function') value(node)
            else refs.set(value, node)
          } else if (value != null) {
            attrs[name] = value
          }
          return attrs
        }, {})

        for (const [name, value] of entries(attrs)) {
          if (name in node) node[name] = value
          else node.setAttribute(name, value)
        }

        const allowed = keys(attrs).concat(fixed)
        for (const { name } of node.attributes) {
          if (!allowed.includes(name)) {
            if (name in node) {
              node[name] = typeof node[name] === 'boolean' ? false : ''
            }
            node.removeAttribute(name)
          }
        }

        /**
         * Replace placeholder values with actual value
         * @param {string} str A node property to match w/ values
         * @returns {string}
         */
        function resolveValue (str) {
          const match = str.match(PLACEHOLDER)
          if (match && match[0] === str) {
            return values[+match[1]]
          }
          return String(str).replace(PLACEHOLDERS, (_, id) => values[+id])
        }
      })
    }
  }

  const children = []
  const oldChildren = toArray(node.childNodes)
  for (const [index, child] of template.childNodes.entries()) {
    const oldChild = oldChildren.find((oldChild) => canMount(oldChild, child))
    let newChild = render(child, ctx, oldChild)
    if (newChild instanceof Placeholder) {
      newChild = child.cloneNode()
      const editor = createNodeEditor(newChild, index, children)
      ctx.editors.push(editor)
    }
    children.push(newChild)
    node.appendChild(newChild)
    if (oldChild) oldChildren.splice(oldChildren.indexOf(oldChild), 1)
  }

  for (const oldChild of oldChildren) {
    oldChild.remove()
  }

  return node

  function createNodeEditor (oldChild, index, list) {
    const id = +oldChild.nodeValue.match(PLACEHOLDER)[1]

    return function editNode (values) {
      let newChild = values[id]

      if (isArray(newChild)) {
        const keys = []
        const oldChildren = isArray(oldChild) ? oldChild : [oldChild]
        // TODO: create lookup table to avoid excessive iteration
        newChild = newChild.flat().map(function (newChild) {
          if (newChild instanceof Partial) {
            console.assert(!keys.includes(newChild.key), 'swf: Each child in an array should have a unique key prop `MyComponent({ key: \'my-key\' })`')
            keys.push(newChild.key)

            for (const [index, child] of oldChildren.entries()) {
              const ctx = cache.get(child)
              if (ctx?.key === newChild.key) {
                ctx.update(newChild.values)
                oldChildren.splice(index, 1)
                return child
              }
            }

            for (const [index, child] of oldChildren.entries()) {
              if (canMount(newChild.template, child)) {
                oldChildren.splice(index, 1)
                return mount(newChild, child, ctx.state)
              }
            }

            return newChild.render(ctx.state)
          }

          newChild = toNode(newChild)
          for (const child of oldChildren) {
            if (canMount(newChild, child)) {
              return mount(newChild, child)
            }
          }

          return newChild
        })

        // FIXME: probably has an impact on performance
        const fragment = document.createDocumentFragment()
        for (const child of newChild) {
          if (child != null) fragment.appendChild(child)
        }
        insert(fragment)

        remove(oldChildren)
      } else {
        if (oldChild) {
          if (newChild instanceof Partial) {
            // TODO: Test old child is array
            const cached = cache.get(oldChild)
            if (cached?.key === newChild.key) {
              cached.update(newChild.values)
              newChild = oldChild
            } else {
              newChild = newChild.render(ctx.state)
            }
          }
        } else if (newChild instanceof Partial) {
          newChild = newChild.render(ctx.state)
        }

        newChild = toNode(newChild)

        let nextChild = newChild
        if (newChild?.nodeType === FRAGMENT_NODE) {
          nextChild = [...newChild.childNodes]
        }

        if (oldChild) {
          if (newChild == null) remove(oldChild)
          else replace(oldChild, newChild)
        } else if (newChild != null) {
          insert(toNode(newChild))
        }

        newChild = nextChild
      }

      oldChild = list[index] = newChild
    }

    function insert (newChild) {
      let next
      for (const value of list.slice(index + 1)) {
        if (isArray(value)) next = value.find(Boolean)
        else next = value
        if (value) break
      }
      if (next) next.before(newChild)
      else node.append(newChild)
    }
  }
}

/**
 * Determine wether two nodes are compatible
 * @param {Node} [a]
 * @param {Node} [b]
 */
function canMount (a, b) {
  if (!a || !b) return false
  if (a.id || b.id) return a.id === b.id
  if (
    (a.nodeType === TEXT_NODE || a.nodeType === COMMENT_NODE) &&
    a.nodeType === b.nodeType
  ) return true
  if (a.nodeName === b.nodeName) return true
  return a.isEqualNode?.(b)
}

/**
 * Unwrap component value
 * @param {Component} component The component to unwrap
 * @param {Context} ctx Current component context
 * @returns {any}
 */
function unwrap (component, ctx) {
  const { fn, args } = component

  try {
    stack.unshift(ctx)

    let { hooks } = ctx
    if (!hooks) hooks = ctx.hooks = []
    return unwind(fn(ctx.state, ctx.emit), function resolve (id, value, next) {
      console.assert(!next || !(value instanceof Promise), 'swf: Detected a promise. Async components are only supported on the server. On the client you should return a placeholder value and rerender (`emit(\'render\')`) when the promise is resolved.')

      if (value instanceof Partial) {
        if (next) hooks.unshift([id, next])
        if (value instanceof Component) {
          value = unwrap(value, ctx)
        }
        return value
      }

      if (typeof value === 'function') {
        if (next) hooks.unshift([id, next])
        if (id === AFTER_UNMOUNT) {
          ctx.render = value
          return value(...args)
        } else {
          return value()
        }
      }

      return next ? next(value) : value
    })
  } finally {
    stack.shift(ctx)
  }
}

function unwind (value, resolve, id = AFTER_UNMOUNT) {
  while (typeof value === 'function' && !(value instanceof Component)) {
    value = resolve(id, value)
  }

  if (isGenerator(value)) {
    let res = value.next()
    return resolve(id, res.value, function next (resolved) {
      res = value.next(resolved)
      const arg = res.done ? res.value : resolve(id, res.value, next)
      return unwind(arg, resolve, id + 1)
    })
  }

  return resolve(id, value)
}

function isGenerator (obj) {
  return obj &&
    typeof obj.next === 'function' &&
    typeof obj.throw === 'function'
}

function parse (strings, isSVG = false) {
  let template = templates.get(strings)
  if (template) return template
  const { length } = strings
  const tmpl = document.createElement('template')
  let html = strings.reduce(function compile (res, string, index) {
    res += string
    if (index === length - 1) return res
    if (ATTRIBUTE.test(res)) res += `__placeholder${index}__`
    else if (TAG.test(res)) res += `data-__placeholder${index}__`
    else res += `<!--__placeholder${index}__-->`
    return res
  }, '').replace(LEADING_WHITESPACE, '$1').replace(TRAILING_WHITESPACE, '$1')

  if (isSVG) html = `<svg>${html}</svg>`
  else console.assert(!html.includes('<svg'), 'swf: It looks likes you\'re trying to render an svg element with the html tag, use the svg tag instead')
  tmpl.innerHTML = html

  const { content } = tmpl
  if (isSVG) {
    const children = content.firstElementChild.childNodes
    template = children.length > 1 ? toNode(toArray(children)) : children[0]
  } else {
    template = content.childNodes.length > 1 ? content : content.childNodes[0]
  }

  const { nodeType, nodeValue } = template
  if (nodeType === COMMENT_NODE && PLACEHOLDER.test(nodeValue)) {
    template = content
  }

  templates.set(strings, template)
  return template
}

function toNode (value) {
  if (value == null) return null

  const type = typeof value

  if (type === 'object' && value.nodeType) return value
  if (type === 'function' || type === 'boolean' || type === 'number' ||
    value instanceof RegExp || value instanceof Date) value = value.toString()

  if (typeof value === 'string') {
    return document.createTextNode(value)
  }

  if (isArray(value)) {
    const fragment = document.createDocumentFragment()
    fragment.append(...value)
    return fragment
  }

  return null
}

function remove (value) {
  if (!isArray(value)) value.remove()
  else for (const child of value) child.remove()
}

function replace (value, child) {
  if (isArray(value)) {
    value[0].replaceWith(child)
    remove(value.slice(1))
  } else {
    value.replaceWith(child)
  }
}

function Placeholder () {}

export class Partial {
  constructor ({ strings, values, isSVG = false }) {
    this.key = strings
    this.strings = strings
    this.values = values
    this.isSVG = isSVG
  }

  get template () {
    return parse(this.strings, this.isSVG)
  }

  render (state = {}) {
    const ctx = new Context(this.key, state)
    const node = render(this.template, ctx)
    ctx.update(this.values)
    cache.set(node, ctx)
    return node
  }
}

export function Component (fn, ...args) {
  Object.setPrototypeOf(Render, Component.prototype)
  Render.key = args[0]?.key || fn
  Render.args = args
  Render.fn = fn
  return Render

  function Render () {
    if (arguments.length) args = arguments
    return new Component(fn, ...args)
  }
}

Component.prototype = Object.create(Partial.prototype)
Component.prototype.constructor = Component
Component.prototype.render = function (state = {}) {
  const ctx = new Context(this.key, state)
  const partial = unwrap(this, ctx)
  if (!(partial instanceof Partial)) return partial
  const node = render(partial.template, ctx)
  ctx.update(partial.values)
  cache.set(node, ctx)
  return node
}

class Context {
  constructor (key, state = {}) {
    this.key = key
    this.editors = []
    this.state = state
    this.emitter = new Emitter()
    this.emit = this.emitter.emit.bind(this.emitter)
  }

  update (values) {
    try {
      stack.unshift(this)
      for (const editor of this.editors) {
        editor(values)
      }
    } finally {
      stack.shift()
    }
  }
}

class Emitter extends Map {
  on (event, fn) {
    const listeners = this.get(event)
    if (listeners) listeners.add(fn)
    else this.set(event, new Set([fn]))
  }

  once (event, fn) {
    this.on(event, (...args) => {
      fn(...args)
      this.removeListener(event, fn)
    })
  }

  removeListener (event, fn) {
    const listeners = this.get(event)
    if (listeners) listeners.delete(fn)
  }

  emit (event, ...args) {
    this.emit('*', [event, ...args])
    if (!this.has(event)) return
    for (const fn of this.get(event)) fn(...args)
  }
}

export class Ref {
  get current () {
    return refs.get(this)
  }
}

class EventHandler extends Map {
  constructor (node) {
    super()
    const cached = events.get(node)
    if (cached) return cached
    this.node = node
  }

  handleEvent (event) {
    const handle = this.get(event.type)
    return handle(event)
  }

  set (key, value) {
    const { node } = this
    const event = key.replace(/^on/, '')
    if (value) node.addEventListener(event, this)
    else node.removeEventListener(event, this)
    super.set(event, value)
  }
}

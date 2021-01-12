import { suite } from 'uvu'
import * as assert from 'uvu/assert'
import { html, mount } from '../../index.js'

const order = suite('order')

order('is rearrenged for array', function () {
  const ul = document.createElement('ul')
  const children = [
    () => html`<li>1</li>`,
    () => html`<li>2</li>`,
    () => html`<li>3</li>`
  ]
  mount(main(), ul)
  const [one, two, three] = ul.childNodes
  assert.is(ul.innerText, '123')
  children.reverse()
  mount(main(), ul)
  assert.is(ul.childNodes[0], three)
  assert.is(ul.childNodes[1], two)
  assert.is(ul.childNodes[2], one)
  assert.is(ul.innerText, '321')

  function main () {
    return html`<ul>${children.map((fn) => fn())}</ul>`
  }
})

order('has no effect outside array', function () {
  const ul = document.createElement('ul')
  const children = [
    () => html`<li>1</li>`,
    () => html`<li>2</li>`,
    () => html`<li>3</li>`
  ]
  mount(main(children), ul)
  const [one, two, three] = ul.childNodes
  assert.is(ul.innerText, '123')
  children.reverse()
  mount(main(children.slice(1), children[0]), ul)
  assert.is(ul.childNodes[0], two)
  assert.is(ul.childNodes[1], one)
  assert.is.not(ul.childNodes[3], three)
  assert.is(ul.innerText, '213')

  function main (children, child) {
    return html`<ul>${children.map((fn) => fn())}${child?.()}</ul>`
  }
})

order('is preserved when similar', function () {
  const ul = document.createElement('ul')
  const children = [
    () => html`<li>1</li>`,
    () => html`<li>2</li>`,
    () => html`<li id="three">3</li>`
  ]
  mount(main(children), ul)
  const [one, two, three] = ul.childNodes
  assert.is(ul.innerText, '123')
  children.splice(1, 2, () => html`<li>2</li>`, () => html`<li>3</li>`)
  mount(main(children), ul)
  assert.is(ul.childNodes[0], one)
  assert.is(ul.childNodes[1], two)
  assert.is.not(ul.childNodes[2], three)
  assert.is(ul.innerText, '123')

  function main (children) {
    return html`<ul>${children.map((fn) => fn())}</ul>`
  }
})

const fragments = suite('fragments')

fragments('do not leak', function () {
  const ul = document.createElement('ul')

  mount(main(html`<li>1</li>`, html`<li>2</li><li>3</li>`), ul)
  assert.is(ul.innerText, '123')

  mount(main(html`<li>1</li>`, html`<li>2</li><li>3</li>`), ul)
  assert.is(ul.innerText, '123')

  mount(main(null, html`<li>2</li><li>3</li>`), ul)
  assert.is(ul.innerText, '23')

  mount(main(html`<li>1</li>`, html`<li>2</li><li>3</li>`), ul)
  assert.is(ul.innerText, '123')

  function main (a, b) {
    return html`<ul>${a}${b}</ul>`
  }
})

order.run()
fragments.run()
// Draws a hooks tree as terminal text, roughly as the terminal surface lays it
// out, and checks it: one autofocus at most, unique hotkeys, every Button acts,
// nothing wider than the pane.

const textOf = node => {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node.type === 'Button') return buttonText(node)
  if (node.type === 'Input') return `${node.props.label ?? ''}[${node.props.value || node.props.placeholder || ''}]`
  return node.children.map(textOf).join(node.type === 'Box' && node.props.gap ? ' '.repeat(node.props.gap) : '')
}

const buttonText = node => {
  const label = node.props.label ?? node.children.map(textOf).join('')
  if (node.props.plain) return node.props.hotkey ? `${node.props.hotkey}: ${label}` : label
  return `[ ${label} ]`
}

const wrap = (text, width) => {
  if (text.length <= width) return [text]
  const out = []
  let rest = text
  while (rest.length > width) {
    const space = rest.lastIndexOf(' ', width)
    const cut = space > width / 3 ? space : width
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^ /, '')
  }
  if (rest) out.push(rest)
  return out
}

export const draw = (node, width) => {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string' || typeof node === 'number') return wrap(String(node), width)
  if (node.type === 'Box') {
    if (node.props.flexDirection === 'row') {
      const line = node.children.map(textOf).join(node.props.gap ? ' '.repeat(node.props.gap) : '')
      return node.props.flexWrap === 'wrap' ? wrap(line, width) : [line]
    }
    return node.children.flatMap(child => draw(child, width))
  }
  if (node.type === 'Text') {
    const text = textOf(node)
    return node.props.wrap === 'truncate' ? [text.length > width ? `${text.slice(0, width - 1)}…` : text] : wrap(text, width)
  }
  return [textOf(node)]
}

const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return
  visit(node)
  node.children.forEach(child => walk(child, visit))
}

export const check = (node, width) => {
  const problems = []
  const hotkeys = new Map()
  let focus = 0
  const keys = new Set()
  walk(node, one => {
    if (one.type === 'Button') {
      if (typeof one.props.onPress !== 'function') problems.push(`Button "${buttonText(one)}" has no onPress`)
      if (one.props.hotkey) {
        if (!/^[0-9a-z]$/.test(one.props.hotkey)) problems.push(`bad hotkey "${one.props.hotkey}"`)
        if (hotkeys.has(one.props.hotkey)) problems.push(`hotkey "${one.props.hotkey}" on both "${hotkeys.get(one.props.hotkey)}" and "${buttonText(one)}"`)
        hotkeys.set(one.props.hotkey, buttonText(one))
      }
      if (one.props.key) {
        if (keys.has(one.props.key)) problems.push(`duplicate key "${one.props.key}"`)
        keys.add(one.props.key)
      }
    }
    if (one.props.autoFocus) focus += 1
  })
  if (focus > 1) problems.push(`${focus} elements autofocus (first wins; the rest are noise)`)
  const lines = draw(node, width)
  lines.forEach((line, index) => {
    if (line.length > width) problems.push(`line ${index + 1} is ${line.length} wide (> ${width}): ${line.slice(0, 50)}…`)
  })
  return { lines, problems }
}

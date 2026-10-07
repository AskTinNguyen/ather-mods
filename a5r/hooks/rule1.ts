// A20: the footer's first rule, a self-drawing Client so a switch redraws this one word and nothing else of the
// pane. It flips between "Love the project" and "Love the country" at random intervals (4–12 s); on the desktop the flip is a
// short ordered dither (▓ ▒ ░ over the letters), on the terminal a plain swap. Its timer lives and dies with the
// element: closing the pane or turning A5R (or motion) off drops it from the tree, and the timer with it.
import type { ClientSurface } from 'claude-code'

type State = { word: number; frame: number }
type Props = { dither?: boolean; color?: string; dim?: boolean }

export const RULE1_WORDS = ['Love the project', 'Love the country'] as const
const STEP_MS = 120
const FRAMES = ['▓', '▒', '░'] // the dither a flip passes through, one frame per step
const wait = (): number => 4_000 + Math.floor(Math.random() * 8_000)

/** The word on screen: the current one, or (mid-flip on the desktop) its letters dithered by an ordered mask. */
export const shown = (word: number, frame: number, dither: boolean): string => {
  const text = RULE1_WORDS[word] ?? RULE1_WORDS[0]
  if (!dither || frame <= 0 || frame > FRAMES.length) return text
  const glyph = FRAMES[frame - 1] ?? '░'
  return [...text].map((ch, i) => (ch === ' ' || (i + frame) % 2 === 0 ? ch : glyph)).join('')
}

export default function Rule1(props: Props, surface: ClientSurface<State>): unknown {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    // Started once: the countdown and the flip frames live in this closure; setState only when the word moves.
    let word = 0
    let left = wait()
    let frame = 0
    surface.setState({ word, frame })
    surface.every(STEP_MS, () => {
      if (frame > 0) {
        frame = frame >= FRAMES.length ? 0 : frame + 1
        surface.setState({ word, frame })
        return
      }
      left -= STEP_MS
      if (left > 0) return
      word = 1 - word
      left = wait()
      frame = props.dither ? 1 : 0
      surface.setState({ word, frame })
    })
  }
  const s = surface.state ?? { word: 0, frame: 0 }
  return Text({ color: props.color, dimColor: props.dim === true, children: shown(s.word, s.frame, props.dither === true) })
}

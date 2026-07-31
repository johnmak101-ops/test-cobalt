import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Mail } from 'lucide-react'
import { ReviewBlock } from './ReviewBlock'

describe('ReviewBlock — the one shell', () => {
  it('draws a titled header and a body', () => {
    render(
      <ReviewBlock title="Field values" icon={Mail} data-testid="b">
        <p>ETA</p>
      </ReviewBlock>,
    )
    const b = screen.getByTestId('b')
    expect(b).toHaveTextContent('Field values')
    expect(b).toHaveTextContent('ETA')
  })

  /** The pill is the ONLY colour on the desk, so "which of these wants me?" is answerable without
   *  reading a word of the bodies. */
  it('says whether it wants an answer', () => {
    const { rerender } = render(<ReviewBlock title="A" status="answer" data-testid="b">x</ReviewBlock>)
    expect(screen.getByTestId('b-status')).toHaveTextContent('needs answer')
    expect(screen.getByTestId('b')).toHaveAttribute('data-status', 'answer')

    rerender(<ReviewBlock title="A" data-testid="b">x</ReviewBlock>)
    expect(screen.getByTestId('b-status')).toHaveTextContent('no action')
    expect(screen.getByTestId('b')).toHaveAttribute('data-status', 'none')
  })

  it('takes bespoke pill wording', () => {
    render(<ReviewBlock title="A" statusLabel="2 to answer" data-testid="b">x</ReviewBlock>)
    expect(screen.getByTestId('b-status')).toHaveTextContent('2 to answer')
  })

  it('prints a count beside the title', () => {
    render(<ReviewBlock title="Source emails" count={3} data-testid="b" />)
    expect(screen.getByTestId('b')).toHaveTextContent('Source emails3')
  })

  it('collapses and expands', async () => {
    const user = userEvent.setup()
    render(
      <ReviewBlock title="Source emails" collapsible data-testid="b">
        <p>the body</p>
      </ReviewBlock>,
    )
    expect(screen.getByTestId('b')).not.toHaveTextContent('the body')
    await user.click(screen.getByRole('button', { name: /Source emails/ }))
    expect(screen.getByTestId('b')).toHaveTextContent('the body')
  })

  /** A header with nothing under it must not draw the divider — an empty rule under a one-line block
   *  is exactly the kind of stray hairline this shell exists to stop. */
  it('drops the divider when there is no body', () => {
    const { container } = render(<ReviewBlock title="A" data-testid="b" />)
    expect(container.querySelector('.border-b')).toBeNull()
  })

  it('puts header controls before the pill', () => {
    render(
      <ReviewBlock title="POs" action={<button type="button">Add PO</button>} data-testid="b">
        x
      </ReviewBlock>,
    )
    expect(within(screen.getByTestId('b')).getByRole('button', { name: 'Add PO' })).toBeInTheDocument()
  })
})

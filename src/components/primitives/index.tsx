import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  children: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    block = false,
    className = '',
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const classes = [
    'button',
    `button--${variant}`,
    `button--${size}`,
    block ? 'button--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...rest} ref={ref}>
      {children}
    </button>
  )
})

export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'block'> & { size?: 'sm' | 'md' }
>(function IconButton({ size = 'md', className = '', children, type = 'button', ...rest }, ref) {
  const classes = ['button', 'icon-button', `icon-button--${size}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...rest} ref={ref}>
      {children}
    </button>
  )
})

export function Card({
  elevated = false,
  className = '',
  children,
}: {
  elevated?: boolean
  className?: string
  children: ReactNode
}) {
  const classes = ['card', elevated ? 'card--elevated' : '', className]
    .filter(Boolean)
    .join(' ')

  return <div className={classes}>{children}</div>
}

export function Input({
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={['input', className].filter(Boolean).join(' ')} {...rest} />
}

export function Textarea({
  className = '',
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={['input', 'textarea', className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
}

export function Select({
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={['input', 'select', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  )
}

type BadgeVariant = 'default' | 'primary' | 'danger' | 'warning'

export function Badge({
  variant = 'default',
  className = '',
  children,
}: {
  variant?: BadgeVariant
  className?: string
  children: ReactNode
}) {
  const classes = [
    'badge',
    variant !== 'default' ? `badge--${variant}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return <span className={classes}>{children}</span>
}

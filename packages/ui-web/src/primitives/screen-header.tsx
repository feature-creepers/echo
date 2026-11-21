/**
 * The top of a page of a screen that covers the main one: its title at the top left, in the display face. The way
 * back is the screen's own, at the top of its sidebar, so the page carries no close button.
 */
export function ScreenHeader({ title }: { title: string }) {
  return <h1 className="display truncate text-[2.5rem] leading-9">{title}</h1>
}

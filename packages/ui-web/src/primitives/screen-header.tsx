/**
 * The top of a page of a screen that covers the main one: its title at the top left. The way back is the screen's
 * own, at the top of its sidebar, so the page carries no close button.
 */
export function ScreenHeader({ title }: { title: string }) {
  return <h1 className="truncate font-semibold text-[1.375rem] leading-8 tracking-[-0.02em]">{title}</h1>
}

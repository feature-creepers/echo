/** A stylesheet whose class names are local to the component that imports it. The bundler does the renaming. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

/** A stylesheet imported for its effect on the page. It exports nothing. */
declare module '*.css' {
  export {}
}

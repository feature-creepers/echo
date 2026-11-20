import type { BlockProps, ViewSpec } from '@repo/catalog'

type TableProps = BlockProps<'Table'>

/**
 * The view with each Table's column keys replaced by their positions, in its columns and in every row. json-render
 * reads an object with a key such as `$state` or `$template` as an expression, and a Table's keys are the only keys
 * of a view the model chooses. They only join a row's cells to their columns and are never shown, so the table
 * looks the same. Every other element is passed through as it is.
 */
export function tableKeys(spec: ViewSpec): ViewSpec {
  if (!Object.values(spec.elements).some((element) => element.type === 'Table')) return spec
  const elements = Object.fromEntries(
    Object.entries(spec.elements).map(([id, element]) => [
      id,
      element.type === 'Table' ? { ...element, props: keyedByPlace(element.props as TableProps) } : element
    ])
  )
  return { ...spec, elements }
}

function keyedByPlace(props: TableProps): TableProps {
  return {
    ...props,
    columns: props.columns.map((column, place) => ({ ...column, key: String(place) })),
    // A cell no column names was never shown, and a row without a column's cell still has none.
    rows: props.rows.map((row) =>
      Object.fromEntries(
        props.columns.flatMap((column, place) => {
          const cell = Object.hasOwn(row, column.key) ? row[column.key] : undefined
          return cell === undefined ? [] : [[String(place), cell]]
        })
      )
    )
  }
}

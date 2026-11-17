/**
 * Writes a JSON Schema as a short type, the way a programmer would jot it down:
 * `{ label: string; value: string; trend?: "up" | "down" | "flat" }`. A model reads this far more reliably,
 * and in far fewer words, than the schema itself.
 */
type Schema = {
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  prefixItems?: Schema[]
  anyOf?: Schema[]
  oneOf?: Schema[]
  additionalProperties?: Schema | boolean
  default?: unknown
}

export function signature(schema: Schema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  const alternatives = schema.anyOf ?? schema.oneOf
  if (alternatives) return alternatives.map(signature).join(' | ')
  if (schema.prefixItems) return `[${schema.prefixItems.map(signature).join(', ')}]`
  if (schema.type === 'array') {
    const item = schema.items ? signature(schema.items) : 'unknown'
    return item.includes(' | ') ? `(${item})[]` : `${item}[]`
  }
  if (schema.type === 'object') {
    const properties = Object.entries(schema.properties ?? {})
    if (properties.length === 0) {
      return typeof schema.additionalProperties === 'object' ? `{ [key: string]: ${signature(schema.additionalProperties)} }` : '{}'
    }
    const required = new Set(schema.required ?? [])
    const fields = properties.map(([name, property]) => {
      // A property with a default may be left out, whatever the schema says about it being required.
      const optional = !required.has(name) || property.default !== undefined
      return `${name}${optional ? '?' : ''}: ${signature(property)}`
    })
    return `{ ${fields.join('; ')} }`
  }
  if (Array.isArray(schema.type)) return schema.type.map((type) => (type === 'integer' ? 'number' : type)).join(' | ')
  if (schema.type === 'integer') return 'number'
  return typeof schema.type === 'string' ? schema.type : 'unknown'
}

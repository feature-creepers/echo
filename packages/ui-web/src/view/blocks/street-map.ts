import 'maplibre-gl/dist/maplibre-gl.css'
import { type GeoJSONSource, Map as MapLibre, setWorkerUrl } from 'maplibre-gl'
import worker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Camera } from './map-geometry.ts'
import { type Mark, marks, streets } from './street-style.ts'

/**
 * MapLibre and the street map's style: a module of its own, which the map block loads the first time it draws a
 * street map, so the window does not carry a library of a megabyte for answers without one.
 */

// MapLibre finds its worker beside its own file only over http. The window's page is a file, and its policy runs
// no script from a blob: or data: address, so the worker is a file of the app, named here.
setWorkerUrl(worker)

/** A street map drawn in an element. */
export interface Streets {
  /** Look at other places, or at the same ones in a frame of another size. */
  show(camera: Camera, places: readonly Mark[]): void
  remove(): void
}

/** A still street map in an element: nothing pans or zooms it, and the block draws its places over it. */
export function drawStreets(container: HTMLElement, camera: Camera, places: readonly Mark[], drawn: () => void): Streets {
  const map = new MapLibre({
    container,
    style: streets(navigator.language.split('-')[0] ?? 'en', places),
    ...camera,
    interactive: false,
    attributionControl: false,
    // The block draws the places where its own arithmetic puts them, so the map looks exactly where it is told,
    // even when that shows past a pole.
    transformConstrain: (center, zoom) => ({ center, zoom })
  })
  map.once('load', drawn)
  // A tile that cannot be read leaves its square empty, as offline; MapLibre would print each one.
  map.on('error', () => undefined)
  return {
    show(camera, places) {
      map.jumpTo(camera)
      const mark = () => map.getSource<GeoJSONSource>('places')?.setData(marks(places))
      // The style's sources are added a moment after the map is made.
      if (map.getSource('places')) mark()
      else map.once('load', mark)
    },
    remove: () => map.remove()
  }
}

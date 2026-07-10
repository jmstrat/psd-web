import { XyParser } from "./text/tabular/XyParser.js"
import { GrParser } from "./text/tabular/GrParser.js"
import { NexusParser } from "./binary/NexusParser.js"

// ParserFactory registers parsers and matches files to an appropriate parser
export class ParserFactory {
  static #registry = new Map()

  static register (extensions, ParserClass) {
    for (const ext of extensions) {
      this.#registry.set(ext.toLowerCase(), ParserClass)
    }
  }

  static getParserForFile (fileName, options) {
    const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
    const ParserClass = this.#registry.get(ext)
    if (!ParserClass) {
      throw new Error(`Unsupported file extension: ${ext}`)
    }
    return new ParserClass(options)
  }
}

ParserFactory.register([".xy", ".csv", ".dat", ".txt"], XyParser)
ParserFactory.register([".gr"], GrParser)
ParserFactory.register([".nxs"], NexusParser)

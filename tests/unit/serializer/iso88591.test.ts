import { describe, expect, it } from 'vitest'
import { encodeIso88591, toIso88591Xml } from '../../../src/serializer/iso88591.js'

// addition: B18, characters outside ISO-8859-1 become numeric references instead of being lost
describe('iso88591', () => {
  it('turns characters above U+00FF into numeric references', () => {
    expect(toIso88591Xml('<a>İstanbul Ömer</a>')).toBe('<a>&#x130;stanbul Ömer</a>')
  })

  it('splits CDATA sections around such characters', () => {
    expect(toIso88591Xml('<a><![CDATA[a<şb]]></a>')).toBe('<a><![CDATA[a<]]>&#x15F;<![CDATA[b]]></a>')
  })

  it('keeps astral characters whole', () => {
    expect(toIso88591Xml('<a>😀</a>')).toBe('<a>&#x1F600;</a>')
  })

  it('encodes Latin-1 letters as single bytes', () => {
    expect(Array.from(encodeIso88591('Ö'))).toEqual([0xd6])
    expect(Array.from(encodeIso88591('ü<a>'))).toEqual([0xfc, 0x3c, 0x61, 0x3e])
  })
})

import { expect, test } from 'claude-code/testing'

import { parseProcs } from '../hooks/system'

test('parseProcs: the last line of the reader, narrowed field by field; a bad line or a bad field is dropped, never thrown', () => {
  expect(parseProcs('{"procs":[{"pid":1,"name":"node","ports":[3000,"x"],"ram":1024},{"pid":"z","name":"q"},{"pid":2,"name":"dotnet"}]}')).toEqual({
    procs: [
      { pid: 1, name: 'node', ports: [3000], ram: 1024 },
      { pid: 2, name: 'dotnet', ports: [] },
    ],
  })
  expect(parseProcs('noise\n{"procs":[]}\n')).toEqual({ procs: [] })
  expect(parseProcs('nope')).toBeUndefined()
  expect(parseProcs('[1]')).toBeUndefined()
  expect(parseProcs('{"cpu":1}')).toBeUndefined()
  expect(parseProcs('')).toBeUndefined()
})

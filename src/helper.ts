interface TestProps {
  _id: string;
  name: string;
}
const testData: TestProps[] = [
  { _id: '1', name: 'a' },
  { _id: '2', name: 'b' }
]
export const arrtoObj = <T extends { _id?: string }>(arr: Array<T>) => {
  return arr.reduce((prev, current) => {
    if (current._id) {
      prev[current._id] = current
    }
    return prev
  }, {} as { [key: string]: T })
}
const result = arrtoObj(testData)

const testData2: { [key: string]: TestProps } = {
  1: { _id: '1', name: 'a' },
  2: { _id: '2', name: 'b' }
}
export const objtoArr = <T>(obj: { [key: string]: T }) => {
  return Object.keys(obj).map(key => obj[key])
}
const result1 = objtoArr(testData2)

interface CheckCondition {
  format?: string[],
  size?: number
}
type ErrorType = 'size' | 'format' | null
export function beforeUploadCheck(file: File, condition: CheckCondition) {
  const { format, size } = condition
  const isVaildFormat = format ? format.includes(file.type) : true
  const isVaildSize = size ? (file.size / 1024 / 1024 < size) : true
  let error: ErrorType = null
  if (!isVaildFormat) {
    error = 'format'
  }
  if (!isVaildSize) {
    error = 'size'
  }
  return {
    passed: isVaildFormat && isVaildSize,
    error
  }
}

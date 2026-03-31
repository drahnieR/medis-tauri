'use strict'

export function get() {
  const data = localStorage.getItem('patternStore')
  return data ? JSON.parse(data) : {}
}

export function set(patterns) {
  localStorage.setItem('patternStore', JSON.stringify(patterns))
  return patterns
}

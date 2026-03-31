'use strict'

export function get() {
  const data = localStorage.getItem('favorites')
  return data ? JSON.parse(data) : []
}

export function set(favorites) {
  localStorage.setItem('favorites', JSON.stringify(favorites))
  return favorites
}

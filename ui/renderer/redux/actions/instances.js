import {createAction, getId} from 'Utils';
import {disconnect} from './connection'

export const createInstance = createAction('CREATE_INSTANCE', data => (
  Object.assign({}, data, {key: getId('instance')})
))

export const selectInstance = createAction('SELECT_INSTANCE')

export const moveInstance = createAction('MOVE_INSTANCE', (from, to) => ({getState, next}) => {
  const {instances} = getState()

  const [fromIndex, instance] = instances.findEntry(v => v.get('key') === from);
  const toIndex = instances.findIndex(v => v.get('key') === to);

  next({fromIndex, toIndex, activeInstanceKey: instance.get('key')})
})

export const delInstance = createAction('DEL_INSTANCE', key => ({getState, next, dispatch}) => {
  const {activeInstanceKey, instances} = getState()
  if (!key) {
    key = activeInstanceKey
  }

  const targetIndex = instances.findIndex(instance => instance.get('key') === key);

  const ret = {activeInstanceKey, targetIndex}

  if (key === activeInstanceKey) {
    const item = instances.get(targetIndex + 1) || (targetIndex > 0 && instances.get(targetIndex - 1))

    if (item) {
      ret.activeInstanceKey = item.get('key')
    } else {
      dispatch(disconnect())
      return
    }
  }

  next(ret)
})

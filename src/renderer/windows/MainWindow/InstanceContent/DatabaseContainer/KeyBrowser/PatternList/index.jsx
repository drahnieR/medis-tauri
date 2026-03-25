'use strict'

import React from 'react'
import {List} from 'immutable'
import {connect} from 'react-redux'
import {createPattern, updatePattern, removePattern} from 'Redux/actions'

import './index.scss'

// ---------------------------------------------------------------------------
// Inline Pattern Manager modal
// ---------------------------------------------------------------------------

class PatternManager extends React.PureComponent {
  constructor(props) {
    super(props)
    this.state = {index: 0, name: null, value: null}
  }

  select(index) {
    this.setState({index, name: null, value: null})
  }

  render() {
    const {patterns, connectionKey, db, onClose, createPattern, updatePattern, removePattern} = this.props
    const key = `${connectionKey}|${db}`
    const active = patterns.get(this.state.index)

    return (
      <div className="pattern-manager-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="pattern-manager-dialog">
          <div className="pattern-manager-header">
            <span>Manage Patterns</span>
            <span className="pattern-manager-close" onClick={onClose}>×</span>
          </div>
          <div className="pattern-manager-body">
            <div className="pattern-manager-list">
              <div className="pattern-manager-items">
                {patterns.map((p, i) => (
                  <a
                    key={p.get('key')}
                    className={'nav-group-item' + (i === this.state.index ? ' is-active' : '')}
                    onClick={() => this.select(i)}
                  >{p.get('name')}</a>
                ))}
              </div>
              <footer>
                <button onClick={() => {
                  const idx = patterns.size
                  createPattern(key)
                  this.setState({index: idx, name: null, value: null})
                }}>+</button>
                <button
                  className={active ? '' : 'is-disabled'}
                  onClick={() => {
                    if (active) {
                      removePattern(key, this.state.index)
                      this.setState({index: Math.max(0, this.state.index - 1)})
                    }
                  }}
                >−</button>
              </footer>
            </div>
            {active && (
              <div className="pattern-manager-form nt-box">
                <div className="nt-form-row nt-form-row--vertical">
                  <label>Name:</label>
                  <input
                    type="text"
                    autoComplete="off" autoCorrect="off" spellCheck={false}
                    value={typeof this.state.name === 'string' ? this.state.name : active.get('name')}
                    onChange={e => this.setState({name: e.target.value})}
                  />
                </div>
                <div className="nt-form-row nt-form-row--vertical">
                  <label>Pattern:</label>
                  <input
                    type="text"
                    autoComplete="off" autoCorrect="off" spellCheck={false}
                    value={typeof this.state.value === 'string' ? this.state.value : active.get('value')}
                    onChange={e => this.setState({value: e.target.value})}
                  />
                </div>
                <div className="nt-button-group nt-button-group--pull-right" style={{marginTop: 10}}>
                  <button
                    className="nt-button nt-button--primary"
                    disabled={this.state.name === '' || this.state.value === ''}
                    onClick={() => {
                      updatePattern(key, this.state.index, {
                        name: this.state.name ?? active.get('name'),
                        value: this.state.value ?? active.get('value'),
                      })
                      this.setState({name: null, value: null})
                    }}
                  >Save</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }
}

function mapStateToProps(state, ownProps) {
  const key = `${ownProps.connectionKey}|${ownProps.db}`
  return {patterns: state.patterns.get(key, List())}
}

const ConnectedPatternManager = connect(mapStateToProps, {createPattern, updatePattern, removePattern})(PatternManager)

// ---------------------------------------------------------------------------
// PatternList
// ---------------------------------------------------------------------------

class PatternList extends React.Component {
  constructor(props) {
    super()
    const saved = localStorage.getItem('patternHistory')
    const patternHistory = saved ? List(JSON.parse(saved)) : new List()
    this.state = {
      patternDropdown: false,
      pattern: props.pattern,
      patternHistory,
      showManager: false,
    }
    this._containerRef = React.createRef()
    this._handleOutsideClick = this._handleOutsideClick.bind(this)
  }

  componentDidMount() {
    document.addEventListener('mousedown', this._handleOutsideClick)
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this._handleOutsideClick)
  }

  _handleOutsideClick(e) {
    if (this.state.patternDropdown &&
        this._containerRef.current &&
        !this._containerRef.current.contains(e.target)) {
      this.setState({patternDropdown: false})
    }
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.db !== this.props.db) {
      this.updatePattern('')
    }
    if (nextProps.pattern !== this.props.pattern) {
      this.setState({pattern: nextProps.pattern})
    }
  }

  updatePattern(value) {
    this.setState({pattern: value})
    this.props.onChange(value)
  }

  updatePatternHistory(value) {
    if (!value) return
    let history = this.state.patternHistory
    const i = history.indexOf(value)
    if (i !== -1) history = history.remove(i)
    history = history.unshift(value).slice(0, 10)
    localStorage.setItem('patternHistory', JSON.stringify(history.toArray()))
    this.setState({patternHistory: history})
  }

  handleKeyDown(evt) {
    if (evt.key === 'Enter') {
      this.updatePatternHistory(evt.target.value)
      this.setState({patternDropdown: false})
    }
  }

  render() {
    const {patterns, connectionKey, db, height} = this.props
    const {patternDropdown, pattern, patternHistory, showManager} = this.state
    const hasHistory = patternHistory.size > 0
    const hasSaved = patterns.size > 0

    return (
      <div className="pattern-input" ref={this._containerRef}>
        <span className="icon icon-search"/>
        <input
          type="search"
          className="form-control"
          placeholder="Key name or patterns (e.g. user:*)"
          value={pattern}
          onChange={evt => this.updatePattern(evt.target.value)}
          onKeyDown={evt => this.handleKeyDown(evt)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {pattern ? (
          <span
            className="pattern-clear"
            onMouseDown={e => { e.preventDefault(); this.updatePattern('') }}
          >×</span>
        ) : null}
        <span
          className={'js-pattern-dropdown icon icon-down-open' + (patternDropdown ? ' is-active' : '')}
          onClick={() => this.setState({patternDropdown: !patternDropdown})}
        />
        <div
          className={'js-pattern-dropdown pattern-dropdown' + (patternDropdown ? ' is-active' : '')}
          style={{maxHeight: height}}
        >
          {hasHistory && <div className="list-header">Recent</div>}
          <ul>
            {patternHistory.map(p => (
              <li
                key={p}
                onClick={() => {
                  this.props.onChange(p)
                  this.setState({patternDropdown: false, pattern: p})
                  this.updatePatternHistory(p)
                }}
              >{p}</li>
            ))}
          </ul>
          {(hasSaved || hasHistory) && hasSaved && <div className="list-header">Saved</div>}
          <ul>
            {patterns.map(p => (
              <li
                key={p.get('key')}
                onClick={() => {
                  const value = p.get('value')
                  this.props.onChange(value)
                  this.setState({patternDropdown: false, pattern: value})
                }}
              >{p.get('name')}</li>
            ))}
            <li
              className="manage-pattern-button"
              onClick={() => this.setState({patternDropdown: false, showManager: true})}
            >
              <span className="icon icon-cog"/>
              Manage Patterns...
            </li>
          </ul>
        </div>

        {showManager && (
          <ConnectedPatternManager
            connectionKey={connectionKey}
            db={db}
            onClose={() => this.setState({showManager: false})}
          />
        )}
      </div>
    )
  }
}

export default connect(
  (state, ownProps) => ({
    patterns: state.patterns.get(`${ownProps.connectionKey}|${ownProps.db}`, List())
  })
)(PatternList)

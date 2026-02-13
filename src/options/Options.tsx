import { useEffect, useState } from 'react'
import './Options.css'

type DuplicateTabHandling = 'none' | 'closeAllButOne' | 'group'

export const Options = () => {
  const [duplicateHandling, setDuplicateHandling] = useState<DuplicateTabHandling>('none')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.sync.get(['duplicateTabHandling'], (result) => {
      if (result.duplicateTabHandling) {
        setDuplicateHandling(result.duplicateTabHandling as DuplicateTabHandling)
      }
    })
  }, [])

  const handleSave = () => {
    chrome.storage.sync.set({ duplicateTabHandling: duplicateHandling }, () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <main>
      <h3>Tab Organizer</h3>

      <section>
        <h4>Duplicate Tabs</h4>
        <p>How should tabs with the same URL be handled?</p>

        <div className="radio-group">
          <label>
            <input
              type="radio"
              name="duplicateHandling"
              value="none"
              checked={duplicateHandling === 'none'}
              onChange={(e) => setDuplicateHandling(e.target.value as DuplicateTabHandling)}
            />
            Do nothing
          </label>

          <label>
            <input
              type="radio"
              name="duplicateHandling"
              value="closeAllButOne"
              checked={duplicateHandling === 'closeAllButOne'}
              onChange={(e) => setDuplicateHandling(e.target.value as DuplicateTabHandling)}
            />
            Keep one, close the rest
          </label>

          <label>
            <input
              type="radio"
              name="duplicateHandling"
              value="group"
              checked={duplicateHandling === 'group'}
              onChange={(e) => setDuplicateHandling(e.target.value as DuplicateTabHandling)}
            />
            Group into tab group
          </label>
        </div>

        <div className="actions">
          <button type="button" onClick={handleSave}>
            Save
          </button>
          {saved && <span className="saved-indicator">Saved</span>}
        </div>
      </section>
    </main>
  )
}

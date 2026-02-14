import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

type DuplicateTabHandling = 'none' | 'closeAllButOne' | 'group'

function isDuplicateTabHandling(value: string): value is DuplicateTabHandling {
  return value === 'none' || value === 'closeAllButOne' || value === 'group'
}

export const Options = () => {
  const [duplicateHandling, setDuplicateHandling] = useState<DuplicateTabHandling>('none')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.sync.get<{ duplicateTabHandling: DuplicateTabHandling }>(
      ['duplicateTabHandling'],
      (result) => {
        if (result.duplicateTabHandling) {
          setDuplicateHandling(result.duplicateTabHandling)
        }
      },
    )
  }, [])

  const handleSave = () => {
    chrome.storage.sync.set({ duplicateTabHandling: duplicateHandling }, () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const handleValueChange = (value: string) => {
    if (isDuplicateTabHandling(value)) {
      setDuplicateHandling(value)
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h3 className="mb-6 text-center text-lg font-semibold tracking-wide text-primary uppercase">
        Tab Organizer
      </h3>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Duplicate Tabs</h4>
          <p className="text-sm text-muted-foreground">
            How should tabs with the same URL be handled?
          </p>
        </div>

        <RadioGroup value={duplicateHandling} onValueChange={handleValueChange}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="none" id="none" />
            <Label htmlFor="none">Do nothing</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="closeAllButOne" id="closeAllButOne" />
            <Label htmlFor="closeAllButOne">Keep one, close the rest</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="group" id="group" />
            <Label htmlFor="group">Group into tab group</Label>
          </div>
        </RadioGroup>

        <div className="flex items-center gap-3 pt-2">
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
          {saved && <span className="text-sm text-green-600">Saved</span>}
        </div>
      </section>
    </main>
  )
}

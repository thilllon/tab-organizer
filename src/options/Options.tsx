import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { DuplicateTabHandling, GroupingMode } from '@/types'

function isDuplicateTabHandling(value: string): value is DuplicateTabHandling {
  return value === 'none' || value === 'closeAllButOne' || value === 'group'
}

function isGroupingMode(value: string): value is GroupingMode {
  return value === 'subdomain' || value === 'domain'
}

export const Options = () => {
  const [duplicateHandling, setDuplicateHandling] = useState<DuplicateTabHandling>('none')
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('subdomain')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.sync.get<{
      duplicateTabHandling: DuplicateTabHandling
      groupingMode: GroupingMode
    }>(['duplicateTabHandling', 'groupingMode'], (result) => {
      if (result.duplicateTabHandling) {
        setDuplicateHandling(result.duplicateTabHandling)
      }
      if (result.groupingMode) {
        setGroupingMode(result.groupingMode)
      }
    })
  }, [])

  const handleSave = () => {
    chrome.storage.sync.set({ duplicateTabHandling: duplicateHandling, groupingMode }, () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const handleDuplicateChange = (value: string) => {
    if (isDuplicateTabHandling(value)) {
      setDuplicateHandling(value)
    }
  }

  const handleGroupingChange = (value: string) => {
    if (isGroupingMode(value)) {
      setGroupingMode(value)
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h3 className="text-center text-lg font-semibold tracking-wide text-primary uppercase">
        Tab Organizer
      </h3>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Tab Grouping</h4>
          <p className="text-sm text-muted-foreground">How should tabs be grouped when sorting?</p>
        </div>

        <RadioGroup value={groupingMode} onValueChange={handleGroupingChange}>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="subdomain" id="subdomain" />
              <Label htmlFor="subdomain">Group by full hostname (subdomain)</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              e.g. mail.google.com and drive.google.com are separated into different groups
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="domain" id="domain" />
              <Label htmlFor="domain">Group by domain only</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              e.g. mail.google.com and drive.google.com are merged into one google.com group
            </p>
          </div>
        </RadioGroup>
      </section>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Duplicate Tabs</h4>
          <p className="text-sm text-muted-foreground">
            How should tabs with the same URL be handled?
          </p>
        </div>

        <RadioGroup value={duplicateHandling} onValueChange={handleDuplicateChange}>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="none" id="none" />
              <Label htmlFor="none">Do nothing</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Duplicate tabs are left as they are
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="closeAllButOne" id="closeAllButOne" />
              <Label htmlFor="closeAllButOne">Keep one, close the rest</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Only the active (or first) tab is kept; all other duplicates are closed automatically
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="group" id="group" />
              <Label htmlFor="group">Group into tab group</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Duplicate tabs are grouped together so you can review and close them manually
            </p>
          </div>
        </RadioGroup>
      </section>

      <div className="flex items-center gap-3 pt-2">
        <Button size="sm" onClick={handleSave}>
          Save
        </Button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>
    </main>
  )
}

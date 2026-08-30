import { describe, it, expect, vi } from 'vitest'
import { parseLsblkTree, withDeadline, type LsblkTree } from './volume-watcher'

/**
 * The lsblk filter, against trees this machine does not have.
 *
 * What is being defended is narrow and specific: the app sweeps what
 * this returns and the path guard trusts it as a root, so a false
 * positive is an offer to ingest, and hand to Drive, the filesystem the
 * machine boots from.
 */
describe('parseLsblkTree', () => {
  /** A USB card reader: RM on the disk, the filesystem on its partition. */
  const cardReader: LsblkTree = {
    blockdevices: [{
      path: '/dev/sdb', type: 'disk', rm: true, hotplug: true, mountpoint: null, fstype: null,
      children: [{
        path: '/dev/sdb1', type: 'part', rm: true, hotplug: true,
        label: 'EOS_DIGITAL', mountpoint: '/run/media/you/EOS_DIGITAL', fstype: 'exfat',
      }],
    }],
  }

  it('finds a mounted card on a removable disk', () => {
    expect(parseLsblkTree(cardReader)).toEqual([{
      path: '/run/media/you/EOS_DIGITAL',
      label: 'EOS_DIGITAL',
      sizeBytes: 0,
      freeBytes: 0,
      fileSystem: 'exfat',
    }])
  })

  it('ignores the removable disk itself, which has no filesystem to sweep', () => {
    expect(parseLsblkTree(cardReader).map(v => v.path)).not.toContain('/dev/sdb')
  })

  it('carries RM down from the disk when the partition does not repeat it', () => {
    const volumes = parseLsblkTree({
      blockdevices: [{
        path: '/dev/sdb', type: 'disk', rm: true,
        children: [{ path: '/dev/sdb1', type: 'part', mountpoint: '/media/card', fstype: 'vfat' }],
      }],
    })
    expect(volumes).toHaveLength(1)
  })

  it('reads the modern `mountpoints` array when `mountpoint` is absent', () => {
    const volumes = parseLsblkTree({
      blockdevices: [{
        path: '/dev/mmcblk0p1', type: 'part', hotplug: true, fstype: 'vfat',
        mountpoints: [null, '/run/media/you/SD'],
      }],
    })
    expect(volumes.map(v => v.path)).toEqual(['/run/media/you/SD'])
  })

  it('takes a built-in SD slot, which reports HOTPLUG but not RM', () => {
    const volumes = parseLsblkTree({
      blockdevices: [{
        path: '/dev/mmcblk0', type: 'disk', rm: false, hotplug: true,
        children: [{
          path: '/dev/mmcblk0p1', type: 'part', rm: false, hotplug: true,
          label: 'NIKON', mountpoint: '/run/media/you/NIKON', fstype: 'exfat',
        }],
      }],
    })
    expect(volumes.map(v => v.label)).toEqual(['NIKON'])
  })

  it('falls back to the mount directory when the card carries no label', () => {
    const volumes = parseLsblkTree({
      blockdevices: [{
        path: '/dev/sdb1', type: 'part', rm: true, label: null,
        mountpoint: '/run/media/you/disk', fstype: 'vfat',
      }],
    })
    expect(volumes[0].label).toBe('disk')
  })

  it('leaves internal disks alone', () => {
    const volumes = parseLsblkTree({
      blockdevices: [{
        path: '/dev/nvme0n1', type: 'disk', rm: false, hotplug: false,
        children: [
          { path: '/dev/nvme0n1p1', type: 'part', mountpoint: '/boot', fstype: 'vfat' },
          { path: '/dev/nvme0n1p2', type: 'part', mountpoint: '/', fstype: 'btrfs' },
        ],
      }],
    })
    expect(volumes).toEqual([])
  })

  it('refuses the root filesystem even on a hotplug-flagged device', () => {
    // A machine booted from an external disk. Removable is true and the
    // mount is real, and sweeping it is still the wrong answer.
    const volumes = parseLsblkTree({
      blockdevices: [{
        path: '/dev/sda', type: 'disk', rm: true,
        children: [
          { path: '/dev/sda1', type: 'part', mountpoint: '/', fstype: 'ext4' },
          { path: '/dev/sda2', type: 'part', mountpoint: '/home', fstype: 'ext4' },
          { path: '/dev/sda3', type: 'part', mountpoint: '/boot/efi', fstype: 'vfat' },
        ],
      }],
    })
    expect(volumes).toEqual([])
  })

  it('is not fooled by a mount point that merely starts like a system one', () => {
    // "/vardrive" is not inside "/var".
    const volumes = parseLsblkTree({
      blockdevices: [{
        path: '/dev/sdb1', type: 'part', rm: true, mountpoint: '/vardrive', fstype: 'exfat',
      }],
    })
    expect(volumes.map(v => v.path)).toEqual(['/vardrive'])
  })

  it('skips swap, which reports "[SWAP]" where a path belongs', () => {
    const volumes = parseLsblkTree({
      blockdevices: [{ path: '/dev/zram0', type: 'disk', rm: true, mountpoint: '[SWAP]', fstype: 'swap' }],
    })
    expect(volumes).toEqual([])
  })

  it('skips an unmounted card: there is nothing to read yet', () => {
    const volumes = parseLsblkTree({
      blockdevices: [{
        path: '/dev/sdb', type: 'disk', rm: true,
        children: [{ path: '/dev/sdb1', type: 'part', rm: true, mountpoint: null, fstype: 'exfat' }],
      }],
    })
    expect(volumes).toEqual([])
  })

  it('survives an empty tree and a missing blockdevices key', () => {
    expect(parseLsblkTree({ blockdevices: [] })).toEqual([])
    expect(parseLsblkTree({})).toEqual([])
  })
})

/**
 * The bound on how long a poll may wait.
 *
 * statfs on a stale mount — a card pulled while the kernel still has it
 * mounted — blocks and never returns. The poll clears its re-entry flag
 * in a `finally`, so one call that never settles stops the watcher for
 * the life of the process. This is what keeps that from happening.
 */
describe('withDeadline', () => {
  it('passes a value through when the work finishes in time', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })

  it('passes the original rejection through rather than masking it', async () => {
    await expect(withDeadline(Promise.reject(new Error('ENOENT')), 50))
      .rejects.toThrow('ENOENT')
  })

  it('rejects when the work outlives the deadline', async () => {
    await expect(withDeadline(new Promise(() => {}), 10)).rejects.toThrow(/timed out/)
  })

  it('clears its timer, so a resolved call holds nothing open', async () => {
    vi.useFakeTimers()
    try {
      await withDeadline(Promise.resolve(1), 5000)
      // A live timer would still be pending here, and would keep the
      // event loop alive for five seconds on every poll.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

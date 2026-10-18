/**
 * 内置卡通头像（自绘 SVG，128×128，无第三方版权）
 * 统一构图：底色圆 → 肩部 → 脖子 → 头部 → 发型 → 五官 → 配饰
 */

const SKIN = '#F6D2B0'
const SKIN_DEEP = '#E8BE99'
const NECK = '#EAC49F'
const EYE = '#33404F'
const MOUTH = '#C07A5C'
const BLUSH = '#F3A9B6'

const eyes = (cx = 64, cy = 56) => `
  <circle cx="${cx - 11}" cy="${cy}" r="3.2" fill="${EYE}"/>
  <circle cx="${cx + 11}" cy="${cy}" r="3.2" fill="${EYE}"/>
  <circle cx="${cx - 9.8}" cy="${cy - 1.2}" r="1" fill="#FFFFFF" opacity="0.9"/>
  <circle cx="${cx + 12.2}" cy="${cy - 1.2}" r="1" fill="#FFFFFF" opacity="0.9"/>`

const smile = (y = 68) =>
  `<path d="M57 ${y}q7 6.5 14 0" fill="none" stroke="${MOUTH}" stroke-width="2.4" stroke-linecap="round"/>`

const blush = (y = 64) => `
  <ellipse cx="45" cy="${y}" rx="5" ry="3.2" fill="${BLUSH}" opacity="0.55"/>
  <ellipse cx="83" cy="${y}" rx="5" ry="3.2" fill="${BLUSH}" opacity="0.55"/>`

const frame = (bg, shirt) => `
  <circle cx="64" cy="64" r="64" fill="${bg}"/>
  <path d="M15 128c1-23 22-37 49-37s48 14 49 37z" fill="${shirt}"/>
  <rect x="54" y="76" width="20" height="18" rx="9" fill="${NECK}"/>
  <circle cx="64" cy="52" r="30" fill="${SKIN}"/>`

const AVATARS = {
  grandpa: `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    ${frame('#DCE9F8', '#5E80A8')}
    <ellipse cx="33" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <ellipse cx="95" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <path d="M33 54c0-18 14-30 31-30s31 12 31 30c-8-9-18-13-31-13s-23 4-30 13z" fill="#D9DFE7"/>
    <ellipse cx="34" cy="62" rx="4.5" ry="8" fill="#D9DFE7"/>
    <ellipse cx="94" cy="62" rx="4.5" ry="8" fill="#D9DFE7"/>
    <circle cx="53" cy="58" r="8.4" fill="none" stroke="#5A6779" stroke-width="1.6"/>
    <circle cx="77" cy="58" r="8.4" fill="none" stroke="#5A6779" stroke-width="1.6"/>
    <path d="M61.4 58h7.2" stroke="#5A6779" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="53" cy="58" r="2.6" fill="${EYE}"/>
    <circle cx="77" cy="58" r="2.6" fill="${EYE}"/>
    <path d="M46 47q7-3 12 0" fill="none" stroke="#B9C2CE" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M70 47q7-3 12 0" fill="none" stroke="#B9C2CE" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M58 66q6 4 12 0" fill="none" stroke="${MOUTH}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M56 72q8-3 16 0q-8 5-16 0z" fill="#C9D1DA"/>
  </svg>`,

  grandma: `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    ${frame('#FBE6ED', '#C4738E')}
    <circle cx="64" cy="19" r="11" fill="#DFE3E9"/>
    <circle cx="64" cy="19" r="11" fill="none" stroke="#C9CFD8" stroke-width="1.2"/>
    <ellipse cx="33" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <ellipse cx="95" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <path d="M33 55c0-19 14-31 31-31s31 12 31 31c-3 3-6 2-8-2-7-6-15-8-23-8s-16 2-23 8c-2 4-5 5-8 2z" fill="#DFE3E9"/>
    <circle cx="34" cy="60" r="2.6" fill="#F5D27A"/>
    <circle cx="94" cy="60" r="2.6" fill="#F5D27A"/>
    ${blush(64)}
    <circle cx="53" cy="58" r="8" fill="none" stroke="#8A6E78" stroke-width="1.5"/>
    <circle cx="77" cy="58" r="8" fill="none" stroke="#8A6E78" stroke-width="1.5"/>
    <path d="M61 58h8" stroke="#8A6E78" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="53" cy="58" r="2.5" fill="${EYE}"/>
    <circle cx="77" cy="58" r="2.5" fill="${EYE}"/>
    <path d="M47 47q6-2.5 11 0" fill="none" stroke="#C3C9D2" stroke-width="2" stroke-linecap="round"/>
    <path d="M70 47q6-2.5 11 0" fill="none" stroke="#C3C9D2" stroke-width="2" stroke-linecap="round"/>
    ${smile(68)}
  </svg>`,

  dad: `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    ${frame('#DFEFE6', '#4F7F6D')}
    <ellipse cx="33" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <ellipse cx="95" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <path d="M32 53c0-19 15-31 32-31s32 12 32 31c-4-10-15-15-32-15s-28 5-32 15z" fill="#2F3640"/>
    <path d="M64 24c-2 6-3 12-3 18" stroke="#252B33" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <path d="M45 46q8-4 14-1" fill="none" stroke="#2F3640" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M69 45q7-3 14 1" fill="none" stroke="#2F3640" stroke-width="2.6" stroke-linecap="round"/>
    ${eyes(64, 57)}
    ${smile(69)}
  </svg>`,

  mom: `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    ${frame('#FDEDDA', '#D98B4F')}
    <path d="M31 52c-4 20-4 38 1 52l13-5c-5-14-6-32-4-47z" fill="#4A3428"/>
    <path d="M97 52c4 20 4 38-1 52l-13-5c5-14 6-32 4-47z" fill="#4A3428"/>
    <ellipse cx="33" cy="55" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <ellipse cx="95" cy="55" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <path d="M32 54c0-19 15-31 32-31s32 12 32 31c-6-9-17-14-32-14s-26 5-32 14z" fill="#4A3428"/>
    <circle cx="34" cy="62" r="2.4" fill="#F0C64F"/>
    <circle cx="94" cy="62" r="2.4" fill="#F0C64F"/>
    ${blush(65)}
    ${eyes(64, 57)}
    <path d="M46 46q7-3 12 1" fill="none" stroke="#4A3428" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M70 47q6-4 12-1" fill="none" stroke="#4A3428" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M58 67q6 7 13 1" fill="none" stroke="#C4577F" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`,

  sister: `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    ${frame('#EFE8FC', '#8B79CE')}
    <path d="M30 52c-5 22-4 42 2 56l14-6c-6-16-7-36-4-52z" fill="#3A2A22"/>
    <path d="M98 52c5 22 4 42-2 56l-14-6c6-16 7-36 4-52z" fill="#3A2A22"/>
    <circle cx="103" cy="46" r="9" fill="#3A2A22"/>
    <circle cx="103" cy="46" r="9" fill="none" stroke="#2E211A" stroke-width="1"/>
    <ellipse cx="33" cy="55" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <ellipse cx="95" cy="55" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <path d="M32 54c0-19 15-31 32-31s32 12 32 31c-6-9-17-14-32-14s-26 5-32 14z" fill="#3A2A22"/>
    <path d="M40 40q10-8 24-8" fill="none" stroke="#F2A7C3" stroke-width="3" stroke-linecap="round"/>
    <circle cx="64" cy="31" r="3" fill="#F2A7C3"/>
    ${blush(65)}
    ${eyes(64, 57)}
    ${smile(68)}
  </svg>`,

  brother: `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    ${frame('#E4F1FA', '#4E9AC4')}
    <ellipse cx="33" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <ellipse cx="95" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <path d="M32 53c0-19 15-31 32-31s32 12 32 31c-3-8-11-13-22-14l-3 7-6-8-4 8-5-8-4 8-6-7c-9 2-14 6-14 14z" fill="#2F3640"/>
    <path d="M45 46q8-4 14-1" fill="none" stroke="#2F3640" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M69 45q7-3 14 1" fill="none" stroke="#2F3640" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="45" cy="45" r="1.2" fill="#F6D2B0"/>
    <circle cx="83" cy="45" r="1.2" fill="#F6D2B0"/>
    <circle cx="53" cy="57.5" r="3.4" fill="${EYE}"/>
    <circle cx="75" cy="57.5" r="3.4" fill="${EYE}"/>
    <circle cx="54.2" cy="56.3" r="1.1" fill="#FFFFFF" opacity="0.9"/>
    <circle cx="76.2" cy="56.3" r="1.1" fill="#FFFFFF" opacity="0.9"/>
    ${blush(66)}
    <path d="M58 68q6 7 13 0" fill="none" stroke="${MOUTH}" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,

  guest: `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    ${frame('#E8EDF4', '#7E8C9E')}
    <ellipse cx="33" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <ellipse cx="95" cy="54" rx="5" ry="7" fill="${SKIN_DEEP}"/>
    <path d="M32 53c0-19 15-31 32-31s32 12 32 31c-5-10-16-15-32-15s-27 5-32 15z" fill="#6B7787"/>
    ${eyes(64, 57)}
    ${smile(68)}
  </svg>`
}

export const AVATAR_PRESETS = Object.keys(AVATARS)

export const AVATAR_LABELS = {
  grandpa: '爷爷',
  grandma: '奶奶',
  dad: '爸爸',
  mom: '妈妈',
  sister: '姐姐',
  brother: '弟弟',
  guest: '自定义'
}

const urlCache = new Map()

export function avatarDataUrl(preset) {
  const key = preset && AVATARS[preset] ? preset : 'guest'
  if (urlCache.has(key)) return urlCache.get(key)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AVATARS[key].trim())}`
  urlCache.set(key, url)
  return url
}

export function avatarSrc(member) {
  if (!member) return avatarDataUrl('guest')
  if (member.avatarUrl) return member.avatarUrl
  if (member.avatarFile) return `/uploads/${member.avatarFile}`
  return avatarDataUrl(member.avatarPreset)
}

export function avatarSrcOf(member, fallbackPreset = 'guest') {
  if (!member) return avatarDataUrl(fallbackPreset)
  if (member.avatarUrl) return member.avatarUrl
  if (member.avatarFile) return `/uploads/${member.avatarFile}`
  return avatarDataUrl(member.avatarPreset || fallbackPreset)
}

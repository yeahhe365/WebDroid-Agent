import { describe, expect, it } from 'vitest'
import { containsSensitiveData, sensitiveCategory } from './sensitiveFilter'

// A real-resident-ID-shaped number: 110105 / 1949-12-31 / seq 002 / check X.
const VALID_ID = '11010519491231002X'

describe('api keys', () => {
  it('catches the well-known key formats', () => {
    expect(sensitiveCategory('sk-proj-9f8e7d6c5b4a3210zyxw')).toBe('api_key')
    expect(sensitiveCategory('ghp_9f8e7d6c5b4a3210zyxwvutsrq1234567890')).toBe('api_key')
    expect(sensitiveCategory('AKIAIOSFODNN7EXAMPLE')).toBe('api_key')
    expect(sensitiveCategory('xoxb-2048-1234-abcdefghijkl')).toBe('api_key')
    expect(
      sensitiveCategory('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'),
    ).toBe('api_key')
  })

  it('treats a bearer header value as a secret', () => {
    expect(containsSensitiveData('Authorization: Bearer 8f4c0d2e9b7a6153c2d1')).toBe(true)
  })

  it('catches a generic assignment, but not the bare word', () => {
    expect(sensitiveCategory('api_key = 8f4c0d2e9b7a6153')).toBe('api_key')
    expect(sensitiveCategory('token: 8f4c0d2e9b7a6153')).toBe('api_key')
    // No `:` or `=` and nothing long enough to be a value.
    expect(sensitiveCategory('the token expired yesterday')).toBeNull()
  })

  it('sees through full-width letters', () => {
    expect(sensitiveCategory('ｓｋ－ｐｒｏｊ－ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐ')).toBe('api_key')
  })
})

describe('id numbers', () => {
  it('accepts a number whose birth date and checksum both hold', () => {
    expect(sensitiveCategory(`我的身份证号是 ${VALID_ID}`)).toBe('id_number')
  })

  it('ignores a number with a bad check digit', () => {
    // Same body, last character off by one: the MOD 11-2 checksum fails.
    expect(sensitiveCategory('110105194912310021')).toBeNull()
  })

  it('ignores a birth date the calendar does not have', () => {
    // 2010-02-30 with a checksum that is correct for that (impossible) body.
    expect(sensitiveCategory('110105201002300028')).toBeNull()
  })

  it('ignores pre-1900 dates', () => {
    expect(sensitiveCategory('110105189912310023')).toBeNull()
  })
})

describe('card numbers', () => {
  it('accepts a Luhn-valid card', () => {
    expect(sensitiveCategory('我的卡号 4111111111111111')).toBe('card_number')
    expect(sensitiveCategory('378282246310005')).toBe('card_number')
  })

  it('accepts a card written in groups', () => {
    expect(sensitiveCategory('4111 1111 1111 1111')).toBe('card_number')
    expect(sensitiveCategory('5500-0055-5555-5559')).toBe('card_number')
  })

  it('accepts the longest card number real issuers use', () => {
    expect(sensitiveCategory('4000000000000000006')).toBe('card_number')
  })

  it('rejects a digit run that fails Luhn', () => {
    expect(sensitiveCategory('4111 1111 1111 1112')).toBeNull()
  })

  it('wins over the keyword rule when both could match', () => {
    // The card is the specific fact here; "密码" only appears in the tail.
    expect(sensitiveCategory('卡号 4111111111111111 密码是 123456')).toBe('card_number')
  })
})

describe('passwords and one-time codes', () => {
  it('catches the keyword before the value', () => {
    expect(sensitiveCategory('the password is hunter2')).toBe('password')
    expect(sensitiveCategory('密码：123456')).toBe('password')
  })

  it('catches the value before the keyword', () => {
    expect(sensitiveCategory('123456 是我的密码')).toBe('password')
  })

  it('joins digits dictated one by one', () => {
    expect(sensitiveCategory('验证码 1 2 3 4')).toBe('password')
  })

  it('sees through full-width digits', () => {
    expect(sensitiveCategory('密码是１２３４５６')).toBe('password')
  })

  it('sees through zero-width characters', () => {
    expect(sensitiveCategory('密码\u200B是 123456')).toBe('password')
  })

  it('only counts pin/otp when a code follows', () => {
    expect(sensitiveCategory('my pin is 4829')).toBe('password')
    expect(sensitiveCategory('otp 551203')).toBe('password')
    expect(sensitiveCategory('PIN码是4829')).toBe('password')
  })
})

describe('facts that are safe to remember', () => {
  it('allows a phone number', () => {
    expect(sensitiveCategory('手机号 138 0013 8000')).toBeNull()
    expect(sensitiveCategory('联系我 13800138000')).toBeNull()
  })

  it('allows an address', () => {
    expect(sensitiveCategory('我住在杭州市西湖区文三路 100 号')).toBeNull()
    expect(sensitiveCategory('我住在杭州')).toBeNull()
  })

  it('allows a birthday', () => {
    expect(sensitiveCategory('我的生日是 1990 年 5 月 20 日')).toBeNull()
    expect(sensitiveCategory('生日 1990-05-20')).toBeNull()
  })

  it('does not trip over pin/otp inside ordinary words', () => {
    expect(sensitiveCategory('I pinned the message to the top')).toBeNull()
    expect(sensitiveCategory('We had hotpot for dinner')).toBeNull()
  })

  it('does not trip over numbers in an ordinary sentence', () => {
    expect(
      sensitiveCategory(
        'Yesterday we walked 12 km, ate 3 apples, reviewed 2 pull requests and got home before 18:30.',
      ),
    ).toBeNull()
    expect(sensitiveCategory('会开到 18 点，来了 12 个人')).toBeNull()
  })
})

describe('edges', () => {
  it('treats an empty string as safe', () => {
    expect(sensitiveCategory('')).toBeNull()
    expect(containsSensitiveData('')).toBe(false)
  })

  it('agrees with the boolean wrapper', () => {
    expect(containsSensitiveData(VALID_ID)).toBe(true)
    expect(containsSensitiveData('明天去买菜')).toBe(false)
  })
})

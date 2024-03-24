import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { verifyMessage } from 'viem'

type Bindings = {
  Web3Login: KVNamespace
}

const generateGraphql = (name: string) => {
  const graphqlReq = `{\"query\":\"query DotAgencyName {\\n  agents(where: {\\n    name: \\\"${name}\\\"\\n  }) {\\n    holder {\\n      address\\n    }\\n  }\\n}\",\"operationName\":\"DotAgencyName\"}`
  return graphqlReq
}

const generateMessage = (domin: string, name: string, nonce: string) => {
  const message =
    `${domin} wants you to sign in with your Wrap Name:
${name}

Version: 1
Nonce: ${nonce}`

  return message
}

const app = new Hono<{ Bindings: Bindings }>()

app.post('/nonce', zValidator(
  'json', z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    domain: z.string().url(),
  })
), async (c) => {
  const { address, domain } = c.req.valid("json")
  const kvIndex = domain + address.toLocaleLowerCase()
  const kvNonce = await c.env.Web3Login.get(kvIndex)

  let nonce: string;
  if (kvNonce === null) {
    const nonceBuffer = new Uint32Array(1)
    nonce = crypto.getRandomValues(nonceBuffer).at(0)!.toString()
    await c.env.Web3Login.put(kvIndex, nonce, { expirationTtl: 60 })
  } else {
    nonce = kvNonce
  }

  return c.text(nonce)
})

app.post('/verify', zValidator(
  'json', z.object({
    dotAgency: z.string(),
    signature: z.string().startsWith("0x"),
    domain: z.string().url(),
  })
), async (c) => {
  const { dotAgency, signature, domain } = c.req.valid("json")

  const graphqlReq = generateGraphql(dotAgency)

  const response = await fetch("https://api.thegraph.com/subgraphs/name/amandafanny/erc7527",
    {
      body: graphqlReq,
      method: "POST"
    }
  )

  const result: any = await response.json()

  if ((result.data.agents as Array<any>).length == 0) {
    return c.json({
      error: "Not Exist"
    })
  } else {

    const holderAddress = result.data.agents[0].holder.address as `0x${string}`
    const kvIndex = domain + holderAddress.toLocaleLowerCase()

    const nonce = await c.env.Web3Login.get(kvIndex) || ""

    try {
      const isVaild = await verifyMessage({
        address: holderAddress,
        message: generateMessage(domain, dotAgency, nonce),
        signature: signature as `0x${string}`,
      })

      if (!isVaild) {
        return c.text("False")
      }
      return c.text("True")
    } catch (err) {
      return c.text("False")
    }
  }
})

export default app

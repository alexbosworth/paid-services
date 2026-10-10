```
Title: Support Offers
Status: Draft
Author: Alex Bosworth
Created: 2026-09-29
License: MIT
```

# Support Offers

## Abstract

This document describes support offers: BOLT 12 offers without an amount
that people pay to support someone, as often as they like and with an amount
they choose.

A support offer is a normal BOLT 12 offer with a label in an odd offer
record, so any wallet that can pay an offer can pay it. An offer can also
suggest amounts to pay in another odd offer record. A wallet that
recognizes the label can ask for the offer's menu: other offers the payer
can choose to pay instead, like an offer to support a particular project.
The menu is asked for with an invoice request and sent back in an invoice
error, one signed page at a time, so it only uses messages that BOLT 12
already has. A payer can also send an offer that it is authorized to present
with a payment, signed by that offer's issuer, so that the recipient can
support it back, and a recipient can put a note in its invoice, like a
thank-you, that the payer can only read after it pays.

## Copyright

This document is licensed under the MIT license.

## Motivation

Creators, projects, and people want a simple way to be supported. A BOLT 12
offer without an amount is that: it can be printed, put on a web page, or
published under a human readable name, and paid again and again.
It needs no web server, and payers do not reveal themselves to one.

Payers often want a hint of what to give, and someone might want to be
supported in more than one way: in general, for a piece of work, or for one
of several projects. Publishing an offer for each makes each one harder to
find, and a payer who finds one does not learn about the others.

This document lets an offer suggest amounts, and lets one published offer
lead to the others, without changing anything for wallets that do not know
about it. For example, a podcast can publish one offer, and a listener's
wallet can show "support the show," "support this episode," and "support
the guest," each with suggested amounts, and show that the guest's offer
pays someone else.

Supporters might also want to be known to the people they support, or to be
supported back. A payer can send an offer of its own with a payment, signed
by the offer's issuer, so that the recipient can see it, and pay it when it
chooses to.

Every payment also leaves the payer a receipt: the BOLT 12 invoice, signed
by the recipient, and the payment preimage that shows that it was paid. A
recipient can put a note in the invoice, like a thank-you, that only a payer
who paid can read.

## Specification

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", and "MAY" are to be
interpreted as described in RFC 2119 and RFC 8174 when, and only when, they
appear in all capitals.

### Conventions

- Types and values are written in decimal, and bytes in hex without a `0x`
    prefix.
- TLV streams, BigSize, and `tu64` are as defined in BOLT 1. Records defined in
    this document that hold an integer hold a `tu64`, except amounts.
- An amount is an 8 byte big-endian number. Amounts are put one after another,
    without lengths.
- A list is its items one after another, each after its BigSize length.
- Unknown records in TLV streams defined in this document follow the BOLT 1
    rule: a reader ignores unknown odd types and does not accept a stream with
    an unknown even type.
- To ignore an unknown record is to not act on it. It is never to leave it out
    of bytes that are signed, hashed, or authenticated. Wherever this document
    checks bytes like these, they are the bytes as they were received, including
    records that the reader does not know, and a reader MUST NOT leave out,
    reorder, or encode again any record before it checks them.
- Records defined by BOLT 12 keep their BOLT 12 encodings and rules.
- A valid BOLT 12 offer is an offer that a BOLT 12 reader would respond to,
    without checking its `offer_chains` or whether it has expired, which this
    document checks where it needs to.
- An onion message of the regular size has an `onion_message_packet` of 1366
    bytes, and a large onion message has one of 32834 bytes, the two sizes that
    BOLT 4 asks for.
- To use a menu page is to show its offers to the payer or to pay them.

### Implementation Levels

This document can be implemented in levels. Each level includes the levels
before it, and each works with every level on the other side, so a wallet
or a recipient can start with the first level and add the others later.

A payer:

- At level 0, does not know this document, and pays a support offer as a normal
    BOLT 12 offer.
- At level 1, reads suggested amounts, as described in Suggested Amounts, and
    support notes, as described in Support Note. It sends no new messages.
- At level 2, also asks for menu pages and reads them, as described in The Menu.
    It MAY leave out entries that are references when it does not look up names.
- At level 3, also sends payer offers, as described in Payer Offer.

A recipient:

- At level 0, can suggest amounts in an offer, as described in Suggested
    Amounts. An offer without `offer_service` is not a support offer, so payers
    do not ask for its menu or send it payer offers, and the recipient replies
    to its invoice requests as BOLT 12 defines.
- At level 1, also labels its offer as a support offer, as described in Support
    Offer, and replies to its invoice requests as described in Reply Size. It
    follows the rules of the recipient in Asking for a Page, which do not need a
    menu: it never makes an invoice for a menu request, and it declines to reply
    to one, or replies with an invoice error with `erroneous_field` set to
    `2000805805`.
- At level 2, also makes and signs menu pages, and replies to menu requests with
    them, as described in The Menu.
- At level 3, also reads payer offers, as described in Payer Offer.

A recipient below level 3 can ignore `invreq_payer_offer`, like a recipient
that does not know it, other than as Reply Size describes, and copies it
into its invoices as BOLT 12 requires.
A recipient at any level MAY add a support note to its invoices, as
described in Support Note.

### Networks

Support offers and their menus are only for Bitcoin networks: bitcoin,
testnet3, testnet4, signet, and regtest, each named in `offer_chains` by the
hash of its genesis block, as BOLT 12 does.

The network of an offer is bitcoin when it has no `offer_chains`, and
otherwise the one chain in `offer_chains` when that is a Bitcoin network.
An offer whose `offer_chains` has no chains or more than one chain, or has
a chain that is not a Bitcoin network, has no network. An offer can be paid
on a network when BOLT 12 allows it: when it has no `offer_chains` and the
network is bitcoin, or when its `offer_chains` has the network.

Every signet has the same genesis block, and so does every regtest network,
so a chain hash does not tell two signets, or two regtest networks, apart.
This document cannot tell them apart either, just as BOLT 12 cannot.

### Suggested Amounts

Any offer for a Bitcoin network without an amount can suggest amounts to
pay in this record:

| Type | Name | Value |
|------|------|-------|
| 1000805807 | `offer_suggested_amounts` | TLV stream of suggested amounts |

The suggested amounts TLV stream has these records:

| Type | Name | Value |
|------|------|-------|
| 0 | `amounts` | Amounts |
| 2 | `currency` | ISO 4217 three letter code, as in `offer_currency` |

A suggested amount is a total to pay. Without `currency`, it is a number of
millisatoshis, a value for `invreq_amount`. With `currency`, it is in the
currency unit adjusted by the ISO 4217 exponent, like USD cents, as
`offer_amount` is with `offer_currency`, and the payer converts it to
millisatoshis for `invreq_amount`.

The writer of an offer:

- MUST NOT set `offer_suggested_amounts` in an offer that has `offer_amount`,
    `offer_currency`, or `offer_quantity_max`.
- MUST NOT set `offer_suggested_amounts` in an offer that does not have a
    network, as described above.
- MUST set `amounts` to at least one amount, and MUST NOT suggest an amount of
    `0`.
- MUST leave out `currency` for amounts in millisatoshis, and otherwise MUST set
    `currency` to the ISO 4217 three letter code of the amounts.
- SHOULD list suggested amounts in the order it wants them shown.

The reader of an offer:

- MUST ignore `offer_suggested_amounts` in an offer that has `offer_amount`,
    `offer_currency`, or `offer_quantity_max`, or that does not have a network.
- MUST ignore `offer_suggested_amounts` when it is not a valid TLV stream, has
    an unknown even type, does not have `amounts`, has `amounts` that are empty,
    whose length is not a multiple of 8, or that have an amount of `0`, or has a
    `currency` that is not three uppercase letters.
- MUST ignore `offer_suggested_amounts` that have a `currency` that it does not
    know, or for which it does not know the ISO 4217 exponent or an exchange
    rate.
- MAY show suggested amounts as choices, in the order they are listed, and MUST
    still allow any amount.
- MUST convert a suggested amount with a `currency` to millisatoshis of the
    offer's network for `invreq_amount`, at an exchange rate of its choice, and
    SHOULD show the payer the amount in the currency and the amount that it will
    pay.
- MUST NOT use a suggested amount when its conversion cannot be represented as a
    valid, nonzero `invreq_amount`, like an amount that converts to less than
    one millisatoshi.

### Service Label

An offer is labeled with a service by its `offer_service` record:

| Type | Name | Value |
|------|------|-------|
| 1000805805 | `offer_service` | TLV stream of the service label |

The service label TLV stream has these records:

| Type | Name | Value |
|------|------|-------|
| 0 | `service_type` | `tu64` service type, `1` for support |
| 2 | `service_version` | `tu64` version of the service |
| 4 | `service_id` | 16 bytes that stay the same when the offer changes |
| 6 | `service_sequence` | `tu64` generation of the offer |

A `service_id` tells apart the offers of one issuer, and names one logical
offer, for one purpose, for as long as that offer lasts: it stays the same when
the writer changes the other fields of the offer, so that readers can know the
changed offer as the same offer, and a writer that wants readers to know an
offer as another purpose gives it a new `service_id`. A `service_sequence` is
the generation of the offer: it is higher in a changed offer than in the offers
before it, so that readers can tell which offer is newer, and it is the same in
copies of the offer that differ only in their `offer_paths`. It is `0` when it
is left out. A service type says whether its offers have a `service_id` and a
`service_sequence`.

The version of the support service described here is `1`. A change that
readers can ignore is made with new odd records and keeps the version. A
change that readers cannot ignore is a new version.

Service type `1` is the support service. Other documents can define other
service types. This document keeps no list of them, so a document that
defines one SHOULD choose its number at random from below 2^32, so that two
documents are unlikely to choose the same one.

A reader of a service label:

- MUST treat the offer as not labeled when `offer_service` is not a valid TLV
    stream, has an unknown even type, has a record with a value that is not
    valid, like a `tu64` that is not minimal or a `service_id` that is not 16
    bytes, or does not have `service_type` and `service_version`.
- MUST treat an offer that is not labeled, or that has a label of a service type
    or version that it does not support, as a normal BOLT 12 offer, wherever it
    finds the offer, like on a menu or as a payer offer.

A label does not prove who made the offer.

A label only adds to what an offer does, so a reader that does not know a
label pays the offer as a normal BOLT 12 offer. A service type or version
that changes how its offers are paid MUST put an even record in the BOLT 12
experimental range for offer records in its offers, so that readers that do
not know it do not pay them.

### Support Offer

An offer is a support offer when its label has `service_type` `1`,
`service_version` `1`, and a `service_id`, it has a network, it has
`offer_issuer_id` and `offer_paths`, and it has no `offer_amount`,
`offer_currency`, or `offer_quantity_max`. A reader MUST treat any other
offer as a normal BOLT 12 offer, including a labeled offer that does not meet
all of these.

The writer of a support offer:

- MUST set `offer_service` to a label with `service_type` `1`, `service_version`
    `1`, and a `service_id`.
- MUST set `service_id` to 16 bytes from a cryptographically secure random
    source for a new support offer, and MUST keep the same `service_id`,
    `offer_issuer_id`, and network when it changes the other fields of a support
    offer that is for the same purpose, like its description, paths, or
    suggested amounts.
- MUST use a new `service_id` when it wants payers to treat a changed offer as a
    different logical support purpose, like support for another project, and not
    as a new generation of the same support offer.
- MUST treat `service_sequence` as the generation of the support offer: support
    offers with the same network, `offer_issuer_id`, `service_id`, and
    `service_sequence` are copies of one generation, and MUST have the same
    records other than `offer_paths`.
- MUST set a higher `service_sequence` when it changes any record of the support
    offer other than `offer_paths`, like its description or suggested amounts,
    and MAY leave it out of a new support offer.
- MUST give every copy of the support offer that it makes the `service_sequence`
    of its newest generation, and MUST NOT make a copy of an older generation
    once it has made a newer one. Copies that it made before, like printed ones,
    or ones listed on pages that have not expired, can still be used.
- MAY publish copies of the newest generation with other `offer_paths`, like a
    copy with paths of its own for each place that shows it, or a copy with new
    paths when the old ones stop working, with the same `service_sequence`.
- SHOULD keep a support offer small, with one offer path of a few hops and a
    short description, so that an invoice for it with one payment path fits in
    an onion message of the regular size with a reply path of a few hops, as
    described in Reply Size. With one offer path of two hops, an invoice is
    about 880 bytes, which leaves room for a reply path of about three hops, and
    with two such paths, it is about 1,100 bytes, which leaves room for a reply
    path of only about one hop.
- MUST NOT use the same `service_id` for two support offers of an
    `offer_issuer_id` that payers are to tell apart.
- MUST use a new `service_id` for a support offer on another network, even for
    the same `offer_issuer_id`.
- MUST NOT set `offer_amount`, `offer_currency`, or `offer_quantity_max`.
- MUST leave out `offer_chains` for an offer on bitcoin, and otherwise MUST set
    `offer_chains` to the one chain hash of the offer's network.
- MUST set `offer_issuer_id` and `offer_paths`.
- SHOULD NOT set `offer_absolute_expiry`.
- MAY set `offer_description`, `offer_issuer`, and `offer_suggested_amounts`.
- MAY set `offer_metadata` for its own use, as BOLT 12 describes.
- SHOULD use an `offer_issuer_id` that is not its node id, and offer paths that
    start at another node.
- MAY use one `offer_issuer_id` for several offers, so that payers can see that
    the offers pay the same recipient.

A support offer is paid as defined by BOLT 12, and the recipient replies to
its invoice requests as described in Reply Size.

A support offer is known by its network, its `offer_issuer_id`, and its
`service_id` together. Anyone can make an offer with any `offer_issuer_id`
and `service_id`, since BOLT 12 offers are not signed, but only the holder
of an `offer_issuer_id` can sign the invoices and menu pages of its offers.

Changing the `offer_issuer_id` or the network of a support offer makes a new
support offer. This document does not define transfer of a support offer's
identity to another issuer key.

A support offer is authenticated for a reader when the holder of its
`offer_issuer_id` signed something that covers the whole offer: an invoice
for it, which repeats its records, a menu page of a support offer with the
same `offer_issuer_id` that lists it as a whole `offer`, or such a page that
lists it as an `offer_without_paths`, when the reader put in the
`offer_paths` of a copy of the support offer of the menu that is
authenticated. A menu page never covers an offer found through a reference,
since it signs only the reference.

A reader can also know who published an offer from the way that it got it, like
from a BIP 353 name, which shows what the name's domain published. That is
weaker than authentication. An offer of the same network, `offer_issuer_id`, and
`service_id` is acceptable for a support offer that a reader keeps when it is
authenticated. Until the reader has kept an authenticated copy of the support
offer, an offer is also acceptable when the reader got it the same way that it
got the support offer, and that way shows who published it, like from the same
BIP 353 name. Authentication only goes one way: once a reader has kept an
authenticated copy of a support offer, only authenticated offers are acceptable
for it, however the reader got them.

The reader of support offers:

- MAY treat support offers with the same network, `offer_issuer_id`, and
    `service_id` as the same support offer, like to replace one that it keeps
    with another, or to show the payments to them together.
- MUST NOT treat support offers with different networks or different
    `offer_issuer_id` values as the same support offer, even when they have the
    same `service_id`.
- MUST NOT replace a support offer that it keeps with another of the same
    network, `offer_issuer_id`, and `service_id` unless the other has a higher
    `service_sequence` and is acceptable for it, other than as the next
    requirement allows. When it replaces a support offer, it replaces every copy
    of it that it keeps.
- MAY replace a support offer that it keeps with one of the same network,
    `offer_issuer_id`, and `service_id` that is authenticated, whatever their
    `service_sequence` and however it got the one that it keeps, like from a BIP
    353 name, as long as it has never kept an authenticated copy of the support
    offer. Once it has, a replacement needs a higher `service_sequence`, as
    above.
- MAY keep another support offer beside one that it keeps, with the same
    network, `offer_issuer_id`, `service_id`, and `service_sequence`, that
    differs from it only in its `offer_paths`, like a copy for another place,
    when the other is acceptable for it, and MAY then use either.
- MUST NOT replace an authenticated copy of a support offer with an offer that
    is not authenticated, or keep a copy that is not authenticated beside one
    that is, however it got that offer.
- MAY drop a copy that it keeps, like one whose paths no longer work, while it
    keeps another copy of the same generation.

### Offer References

A reference names an offer in a few bytes: a BIP 353 name where the offer
can be found, the `offer_issuer_id` of the offer, and for a support offer,
its `service_id`, and the lowest `service_sequence` of it to use. A payer
offer and a menu entry can each be a reference, with these records:

| Type | Name | Value |
|------|------|-------|
| 2 | `name` | BIP 353 name of the offer, as in `invreq_bip_353_name` |
| 4 | `issuer_id` | 33 byte `offer_issuer_id` of the offer at `name` |
| 6 | `service_id` | 16 byte `service_id` of the support offer at `name` |
| 10 | `service_sequence` | `tu64` lowest `service_sequence` to use |

A reference is for a network: for a payer offer, the network of the support
offer that the request pays, and for a menu entry, the network of the
support offer of the menu.

A reference with a `service_id` refers to the support offer with its network,
`issuer_id`, and `service_id`, in a valid version that has not expired, found at
`name`, whose `service_sequence` is not lower than the `service_sequence` of the
reference, which is `0` when it is left out. A reference without `service_id`
refers to whatever valid offer that has not expired is found at `name` when it
is looked up, that has the `offer_issuer_id` of `issuer_id` and can be paid on
the network of the reference. It does not identify one offer, and can lead to
another offer when what is published at the name changes. A reference never
refers to an offer that is not valid, or that has expired.

A reference is signed with what carries it: a menu entry by the recipient, with
its page, and a payer offer by the holder of `issuer_id`. The signature covers
the reference and its network, and not the offer found at `name`. So the holder
of `issuer_id` signed the reference when it is in a payer offer, or in a menu
entry whose `issuer_id` is the `offer_issuer_id` of the support offer of the
menu, and otherwise only the recipient that listed it did.

The writer of a reference:

- MUST set `name` to a BIP 353 name where the offer can be found, and
    `issuer_id` to the `offer_issuer_id` of that offer.
- MUST set `service_id` to the `service_id` of the offer when it is a support
    offer, and MUST leave it out otherwise.
- SHOULD set `service_sequence` to the highest `service_sequence` that it knows
    of for the support offer, and MUST leave it out when that is `0`, or when
    the reference has no `service_id`.

The reader of a reference:

- MUST NOT use a reference when `name` is not valid as in `invreq_bip_353_name`,
    when `issuer_id` is not a valid point, when it has a `service_id` that is
    not 16 bytes, or when it has a `service_sequence` that is not a minimal
    `tu64` or that is without a `service_id`.
- MAY look up the offer at the `name`, as BIP 353 describes.
- SHOULD look up the `name` in a way that does not show its IP address, or that
    of a resolver that only it uses, to the servers of the name's domain, like
    over Tor, or by asking a node for a DNSSEC proof over onion messages.
- MUST NOT use an offer for a reference, whether it finds the offer at the
    `name` or keeps it, unless the offer is a valid BOLT 12 offer that has not
    expired, and MUST check that each time that it uses the offer.
- MUST NOT use an offer found at the `name` unless it has the `offer_issuer_id`
    of `issuer_id` and can be paid on the network of the reference, and, when
    the reference has a `service_id`, unless it is a support offer with that
    `service_id` on that network, and with a `service_sequence` that is not
    lower than that of the reference.
- MUST NOT use, for a reference, a version of the support offer that it keeps,
    as described in Support Offer, with a `service_sequence` lower than that of
    the reference, and SHOULD use a version that it keeps that is authenticated
    instead of one found at the `name` with a lower `service_sequence`.
- MUST NOT show the `name` as the name of the offer until it finds an offer at
    the name that it can use, and MAY show it before then only as a name that
    has not been checked.
- MUST NOT show the `name` as one that the holder of `issuer_id` authorized
    unless that holder signed the reference, in a payer offer, or in a menu
    entry whose `issuer_id` is the `offer_issuer_id` of the support offer of the
    menu, and otherwise MAY show it as a name that the recipient listed.
- MUST NOT show an offer found at the `name` as an offer that the signer of the
    reference signed, listed, or presented exactly as it is, and MAY show that
    the signer signed the reference that the offer was found through.
- MUST NOT show the text of an offer found at the `name`, like its
    `offer_description`, as signed by anyone, until the holder of its
    `offer_issuer_id` signs an invoice for it, which repeats its records: until
    then, it is only what was published at the name.
- MAY know a reference with a `service_id` as a reference to the support offer
    with its network, `issuer_id`, and `service_id`, before it looks up the
    name.

### Payer Offer

A payer can send an offer that it is authorized to present with a payment,
like a support offer, so that the recipient can support it back. The offer
goes in this invoice request record:

| Type | Name | Value |
|------|------|-------|
| 2000805807 | `invreq_payer_offer` | TLV stream of the payer offer |

The payer offer TLV stream has these records:

| Type | Name | Value |
|------|------|-------|
| 0 | `offer` | The offer, as its TLV stream bytes |
| 2 | `name` | As in Offer References |
| 4 | `issuer_id` | As in Offer References |
| 6 | `service_id` | As in Offer References |
| 8 | `expiry` | `tu64` seconds from the UNIX epoch |
| 10 | `service_sequence` | As in Offer References |
| 240 | `signature` | BIP 340 signature of the payer offer |

A payer offer is the whole `offer`, or a reference to it, with `name`,
`issuer_id`, and for a support offer, `service_id` and `service_sequence`,
as described in Offer References. An `expiry` is signed with the payer
offer, and is when it can no longer be presented.

The `signature` is a BIP 340 signature by the key of the issuer id, the
`offer_issuer_id` of `offer` or the `issuer_id` of a reference, with its x
coordinate as the BIP 340 public key, of:

```
payer_offer_hash = SHA256(SHA256(tag) || SHA256(tag) || chain_hash ||
  invreq_payer_id || payer_offer)
```

where `tag` is `support-payer-offer-signature`, `chain_hash` is the 32 byte hash
that names the network of the support offer that the request pays in
`offer_chains`, even when that support offer leaves `offer_chains` out, which is
also the network of a reference, `invreq_payer_id` is the 33 byte
`invreq_payer_id` of the invoice request, and `payer_offer` is the
`invreq_payer_offer` value as it was received, with the bytes of its `signature`
record cut out and nothing else changed. The signature covers the network and
every other record of the payer offer, including records that the reader does
not know.

The payer:

- MAY add `invreq_payer_offer` to a request to pay a support offer, and MUST NOT
    add it to a menu request.
- MUST only add `invreq_payer_offer` when the payer chooses to, since it links
    the payment to the offer.
- MUST set either `offer` alone, or a reference, and not both.
- When it sets `offer`, MUST set it to a valid BOLT 12 offer that has not
    expired, has an `offer_issuer_id`, and can be paid on the network of the
    support offer that the request pays.
- When it sets a reference, MUST set it as described in Offer References.
- MAY set `expiry`, like when the holder of the offer only authorizes the payer
    for a time.
- MUST NOT send a payer offer whose `expiry` has passed, and SHOULD NOT send one
    whose `expiry` might pass before the recipient reads the request.
- SHOULD send a reference when the offer can be found at a BIP 353 name, since a
    reference is much smaller than an offer.
- MUST set `signature` as described above, after every other record of the payer
    offer is set.
- MUST add `invreq_payer_offer` to the invoice request before it calculates the
    BOLT 12 signature over the request.
- SHOULD keep `invreq_payer_offer` small, since the invoice holds it too. A
    reference is about 120 to 150 bytes, and an offer with paths can be several
    hundred.
- SHOULD send a request with a whole `offer` in a large onion message, since its
    invoice is not likely to fit in one of the regular size.
- MAY pay again without `invreq_payer_offer` when no reply arrives, or when an
    invoice error has `erroneous_field` set to `2000805807`, or, when Reply Size
    allows it, MAY instead send the request again in a large onion message.

The recipient:

- MUST ignore `invreq_payer_offer` when it is not a valid TLV stream, has an
    unknown even type, or does not have a 64 byte `signature`.
- MUST ignore `invreq_payer_offer` when it has an `expiry` that is not a minimal
    `tu64`, or that has passed when it reads the request.
- MUST ignore `invreq_payer_offer` unless it has either `offer` and none of
    `name`, `issuer_id`, `service_id`, and `service_sequence`, or `name` and
    `issuer_id` and not `offer`.
- MUST ignore `invreq_payer_offer` when `offer` is not a valid BOLT 12 offer,
    has expired, does not have an `offer_issuer_id`, or cannot be paid on the
    network of the support offer that the request pays, when it is a reference
    that cannot be used, as described in Offer References, or when `signature`
    is not valid.
- MUST check the `signature` of a reference before it looks up its `name`, and
    MUST NOT look up the `name` of a reference that it ignores.
- MUST NOT delay or reject a request to pay to look up a `name`.
- SHOULD only look up the `name` of a reference once the invoice for its request
    is paid.
- MUST NOT reject a request to pay because its `invreq_payer_offer` is ignored,
    or because the payer offer is not one that it would pay.
- MUST NOT pay a payer offer unless its user chooses to.
- MAY know a payer offer that is a support offer by its network,
    `offer_issuer_id`, and `service_id`, like to recognize successive versions
    of the same payer offer, or to group payments in which that same offer was
    presented.
- MAY show a whole `offer` with a valid signature as an offer that the holder of
    its `offer_issuer_id` authorized the holder of the `invreq_payer_id` key to
    present, and MAY show its text as signed by the holder of its
    `offer_issuer_id`.
- MAY show an offer found at the `name` of a reference that it can use as found
    through a reference that the holder of `issuer_id` authorized the holder of
    the `invreq_payer_id` key to present, as described in Offer References.
- MUST treat a payer offer that is not a support offer as a normal BOLT 12
    offer.

### Support Note

A recipient can put a note in an invoice, like a thank-you, that the payer
can only read after it pays. The note goes in this invoice record, in the
BOLT 12 experimental range for invoice records:

| Type | Name | Value |
|------|------|-------|
| 3000805805 | `invoice_support_note` | The note, sealed to the payment preimage |

The note is UTF-8 text of 1 to 128 bytes. It is sealed with
ChaCha20-Poly1305, as RFC 8439 describes, under the key:

```
note_key = SHA256(SHA256(tag) || SHA256(tag) || payment_preimage || salt)
```

where `tag` is `support-note`, `payment_preimage` is the 32 byte preimage of
the `invoice_payment_hash` of the invoice, and `salt` is 16 bytes from a
cryptographically secure random source. The nonce is 12 zero bytes, and
there is no associated data. The value of `invoice_support_note` is the
`salt`, then the sealed text, then its 16 byte authentication tag, so it is
33 to 160 bytes long.

The recipient:

- MAY add `invoice_support_note` to an invoice for a request to pay.
- MUST set the note to UTF-8 text of 1 to 128 bytes, sealed as described above,
    with a new `salt` for each note that it seals.
- MAY make the note depend on the request, like on its amount, its
    `invreq_payer_note`, or its `invreq_payer_offer`.
- MUST NOT use a payment preimage in invoices for more than one request when any
    of those invoices has `invoice_support_note`, since a payer that learns the
    preimage by paying one invoice can open the note of every other invoice with
    it, like one for a larger amount, without paying that one.
- MAY leave out `invoice_support_note` to make an invoice fit, as described in
    Reply Size.
- SHOULD only put in a note what it does not mind others seeing, since a payer
    can show the note to anyone once it has paid.

The payer:

- MAY open `invoice_support_note` once its payment succeeds, with the preimage
    that it learns from the payment.
- MUST ignore `invoice_support_note` when its value is not 33 to 160 bytes long,
    when it cannot be opened with the preimage, or when it opens to text that is
    not valid UTF-8.
- MUST show the note as text from the recipient, set apart from its own text, so
    that the note cannot be mistaken for a message of the wallet.
- SHOULD show the note as plain text, and MUST NOT follow a link in it unless
    its user chooses to.

### Reply Size

A reply to an invoice request goes over the reply path of the request,
which the requester chooses. An invoice holds every record of its request
other than its signature, with a few hundred bytes of its own, like its
payment paths, so an invoice for a request that fits in an onion message of
the regular size might not fit in one.

An invoice error can say, with this record, that the reply to a request did
not fit in an onion message of the size that the request arrived in:

| Type | Name | Value |
|------|------|-------|
| 805807 | `reply_too_large` | Empty |

The recipient of a support offer:

- MUST NOT reply to an invoice request in an onion message that is larger than
    the one that the request arrived in.
- MUST treat a request as having arrived in an onion message of the regular size
    when it does not know the size of the onion message that the request arrived
    in.
- SHOULD leave out payment paths of an invoice, when it has more than one, and
    MAY leave out its `invoice_support_note`, so that the invoice fits in an
    onion message of the size that its request arrived in.
- MUST leave out a payment path by leaving out both its `blinded_path` in
    `invoice_paths` and its `blinded_payinfo` in `invoice_blindedpay`, so that
    each path that is left still has its own `blinded_payinfo`, and MUST keep at
    least one path, as BOLT 12 requires.
- MUST NOT send an invoice that does not fit in an onion message of the size
    that its request arrived in, and SHOULD reply with an invoice error instead.
- MUST set `reply_too_large`, with an empty value, in an invoice error that it
    sends instead of an invoice or a menu page that does not fit in an onion
    message of the size that the request arrived in, when it knows that the
    request arrived in an onion message of the regular size, and MUST NOT set
    `reply_too_large` in any other invoice error, including when it does not
    know the size, since it would not reply larger to the same request in a
    large onion message.
- SHOULD set `erroneous_field` to `2000805807` in an invoice error that it sends
    instead of an invoice that does not fit, when the request has
    `invreq_payer_offer` and the invoice would fit without it, so that the payer
    can pay again without it, and MUST NOT set `erroneous_field` to `2000805807`
    in any other invoice error. This is the only reason to decline a request to
    pay because of its `invreq_payer_offer`.
- MAY make these choices from the size of the request, before it makes the
    invoice, since the invoice is larger than the request.

The payer:

- MAY send an invoice request in a large onion message, like when the request
    does not fit in one of the regular size, or when it expects that the invoice
    will not.
- MAY send a request to pay again in a large onion message when it sent it in
    one of the regular size and no reply arrives, or an invoice error with
    `reply_too_large` arrives, and MUST NOT send it again in a large onion
    message because of any other invoice error.
- MUST ignore the value of `reply_too_large`.

### The Menu

The menu of a support offer is a list of offers. It is split into pages,
and each page is signed by the recipient.

#### Asking for a Page

A payer asks for a page of the menu with an invoice request that has this
record:

| Type | Name | Value |
|------|------|-------|
| 2000805805 | `invreq_support_menu` | TLV stream of options |

The options TLV stream has these records:

| Type | Name | Value |
|------|------|-------|
| 0 | `page` | `tu64` number of the page, from `0` |

The requester:

- MUST only ask for the menu of a support offer.
- MUST write the invoice request as BOLT 12 requires, and MUST add
    `invreq_support_menu` to it before it calculates the BOLT 12 signature over
    the request, so that the signature covers `invreq_support_menu`.
- MUST set `invreq_amount` to `1000`.
- MUST NOT set `invreq_payer_note`.
- MUST use a new `invreq_payer_id` and a new, unpredictable `invreq_metadata`
    for each menu request, and MUST NOT use them in any other invoice request,
    like the request to pay that follows. BOLT 12 asks for a transient
    `invreq_payer_id` and unpredictable `invreq_metadata`, and this makes them
    new for every menu request.
- MUST leave out `page` to ask for the first page.
- MUST NOT ask for a page that is not below the `pages` of a page it has.
- SHOULD only ask for a page after the first when the payer wants to see more
    offers.
- MUST send the request over one of the offer paths, with a reply path back to
    itself.
- MUST use a new reply path for each menu request, with a new `path_id` of at
    least 16 bytes from a cryptographically secure random source.
- SHOULD start the reply path at a node other than itself, and SHOULD keep the
    reply path to a few hops, so that a page fits in an onion message of the
    regular size.
- MUST only accept a reply that arrives on that reply path, by checking that the
    `path_id` in the reply's `encrypted_recipient_data` is the `path_id` it set,
    and MUST only use the first reply that it accepts.
- SHOULD show the support offer and its suggested amounts, and let its user pay
    it, as soon as it reads the offer, and, when it asks for the menu, ask in
    the background and show the page when it arrives, instead of waiting for it.
- SHOULD stop waiting for a reply after a time, like 30 seconds.
- MAY send a new menu request over another offer path when no reply arrives.

The recipient:

- MUST NOT reply to a menu request that did not arrive on one of the
    `offer_paths` of the support offer in the request, or that is not valid
    under BOLT 12.
- MUST NOT make an invoice for a menu request.
- MUST NOT reject a menu request because of the value of its `invreq_amount`.
- MUST ignore `invreq_payer_note` and `invreq_payer_offer` in a menu request.
- MUST NOT reply with a page when `invreq_support_menu` is not a valid TLV
    stream or has an unknown even type, or when it has no page with the number
    of `page`, and SHOULD reply with an invoice error with `erroneous_field` set
    to `2000805805`.
- Otherwise, when it replies, MUST reply with the page, as described below, or,
    when it cannot, like when it has no signed page that has not expired, or
    when the page does not fit in an onion message of the size that the request
    arrived in, with an invoice error with `erroneous_field` set to
    `2000805805`, and with `reply_too_large` when the page does not fit, as
    described in Reply Size.
- MAY decline to reply, like when it limits how many requests it answers, or
    when the reply path of the request has many hops.

An invoice request without `invreq_support_menu` is a request to pay, as
defined by BOLT 12.

#### Replying With a Page

The reply is an invoice error with its BOLT 12 `error` record set to a short
explanatory string, like `SupportMenu`, and this record:

| Type | Name | Value |
|------|------|-------|
| 805805 | `support_menu` | TLV stream of the page |

The `support_menu` TLV stream has these records:

| Type | Name | Value |
|------|------|-------|
| 0 | `entries` | List of entries |
| 2 | `page` | `tu64` number of the page, `0` when left out |
| 4 | `pages` | `tu64` number of pages, `1` when left out |
| 6 | `absolute_expiry` | `tu64` seconds from the UNIX epoch |
| 8 | `menu_id` | 16 bytes that are the same in every page of the menu |
| 240 | `signature` | BIP 340 signature of the page |

Each entry in `entries` is a TLV stream with these records:

| Type | Name | Value |
|------|------|-------|
| 0 | `offer` | The offer, as its TLV stream bytes |
| 2 | `name` | As in Offer References |
| 4 | `issuer_id` | As in Offer References |
| 6 | `service_id` | As in Offer References |
| 8 | `offer_without_paths` | The offer without `offer_paths`, as its bytes |
| 10 | `service_sequence` | As in Offer References |

An entry is an offer in one of three forms:

- `offer`: the whole offer, as the TLV stream that the offer string encodes,
    without the string encoding.
- `offer_without_paths`: an offer of the recipient that is reached over the
    paths of the support offer, as its TLV stream without its `offer_paths`
    record. The offer of the entry is this TLV stream with the `offer_paths`
    record of a copy of the support offer put in, like the copy that the reader
    asked for the page with, in type order, and every other record kept as it
    is. The page does not sign those paths.
- A reference to the offer, with `name`, `issuer_id`, and for a support offer,
    `service_id` and `service_sequence`, as described in Offer References.

The offer of each entry is a whole BOLT 12 offer that can be paid by
itself, with its own suggested amounts.

The writer of the menu, who makes and signs its pages:

- MUST split its entries into pages in the order it wants them shown, and number
    the pages from `0`, and SHOULD put as many entries on each page as fit.
- MUST make at least one page, with no entries when it has no offers, so that
    there is always a first page to reply with.
- MUST NOT make a `support_menu` value longer than 768 bytes.
- MUST NOT list an entry that does not fit on a page by itself.
- MUST NOT list an offer that cannot be paid on the network of the support
    offer.
- MUST set each entry to one form: `offer` alone, `offer_without_paths` alone,
    or a reference, as described in Offer References.
- MUST set `offer` to a valid BOLT 12 offer.
- MUST only use `offer_without_paths` for an offer that has the
    `offer_issuer_id` of the support offer, and that it answers invoice requests
    for on the paths of every copy, of every generation, of the support offer
    that it still answers, and MUST leave out its `offer_paths`.
- SHOULD list an offer without its paths, or as a reference, when it can, since
    most of a whole offer is its paths.
- MUST leave out `entries` when a page has no entries, `page` when it is `0`,
    and `pages` when it is `1`.
- MUST set `absolute_expiry`, `menu_id`, and `signature` in each page.
- MUST set the same `menu_id` in every page of the menu.
- MUST set a new `menu_id` when any record of a page other than
    `absolute_expiry` and `signature` would change, and MAY keep the `menu_id`
    when it signs the same pages again, like with a later `absolute_expiry`.
- When a new `menu_id` is required, MUST choose a value that it has not used for
    different menu contents whose pages might still be used, and SHOULD derive
    it collision-resistantly from the menu contents, the records of its pages
    other than `absolute_expiry`, `menu_id`, and `signature`, or choose 16 bytes
    from a cryptographically secure random source.
- SHOULD set `absolute_expiry` to no later than it expects the menu to change,
    like a day ahead, and sign its pages again before they expire.
- MAY set a later `absolute_expiry`, like a week ahead, when it is often offline
    and cannot sign its pages again that often, so that a service that answers
    for it can send its pages for longer, though an old page can then be shown
    for longer after its menu changes.
- MAY list any offers, like other support offers, offers with an amount, and
    offers with a different `offer_issuer_id`.

Menus are not ordered: pages have no sequence, so a reader cannot tell which of
two menus is newer. The `absolute_expiry` of the pages of a menu, and not an
order of menus, is what limits rollback to an older menu: anyone who has its
pages can send them again, and a reader can use them, until they expire. A
recipient chooses how long an older menu can be shown when it chooses the
`absolute_expiry` of its pages.

The reader of the menu:

- MUST NOT use a page whose `support_menu` value is longer than 768 bytes, is
    not a valid TLV stream, has an unknown even type, has a record with a value
    that is not valid, like a `tu64` that is not minimal, has `entries` that are
    not a valid list, or has a `page` that is not below `pages`.
- MUST NOT use a page that does not have `absolute_expiry`, whose
    `absolute_expiry` has passed, that does not have a `menu_id` of 16 bytes, or
    that is not signed, as described below.
- MUST NOT use a page with a `page` other than the page it asked for.
- MUST only use pages together, as one menu, when they have the same `menu_id`,
    and MAY drop the pages that it has and ask for the menu again from the first
    page when a page that it asks for has another `menu_id`.
- MUST leave out entries that are not a valid TLV stream, have an unknown even
    type, or are not exactly one of the three forms.
- MUST leave out an entry with `offer_without_paths` that has an `offer_paths`
    record, or whose offer does not have the `offer_issuer_id` of the support
    offer, and an entry with a reference that it cannot use, as described in
    Offer References.
- MUST leave out entries for an offer that is not a valid BOLT 12 offer, cannot
    be paid on the network of the support offer, or has expired.
- SHOULD only look up the `name` of a reference when the payer chooses to see or
    pay its offer, and not ahead of time.
- MUST treat an entry for an offer that is not a support offer, including one
    with a label that it does not support or that is not valid, as a normal BOLT
    12 offer.
- MAY keep a page and use it again until its `absolute_expiry`, and MUST check
    each time it uses the page that the page and its offers have not expired.
- MUST NOT show an entry as paying the recipient of the support offer unless the
    entry has the same `offer_issuer_id` as the support offer, and MUST treat an
    entry without `offer_issuer_id` as having a different one.
- MUST show an entry with a different `offer_issuer_id` as listed by the
    recipient, or for a reference, as found through a reference that the
    recipient listed, and as paying someone other than the recipient, and MUST
    NOT show its text, like its `offer_description` and `offer_issuer`, as
    coming from the holder of its `offer_issuer_id`.
- MUST NOT show a name or label that it has for the support offer, like a human
    readable name it used to find the offer, with an entry that has a different
    `offer_issuer_id`.
- MUST NOT set `invreq_bip_353_name`, in an invoice request for an entry, to a
    name that it used to find the support offer.
- SHOULD show each entry with its `offer_description` and `offer_issuer`, and
    make clear when it has an amount or an expiry.
- SHOULD only ask for the menu of an entry when the payer chooses to see it, and
    not ahead of time.

The payer reads a reply to a menu request, when there is no page in it that
it can use, by the first of these that applies to it:

- An invoice is the recipient not supporting the menu. The payer MUST NOT pay
    it.
- An invoice error with a `support_menu`, or with `erroneous_field` set to
    `2000805805`, is the recipient not answering this request with a page that
    the payer can use, like for a page that it does not have. The payer MAY ask
    again later, over another offer path, or with a shorter reply path, and MAY
    still use the pages that it has, as described above. When the invoice error
    has `reply_too_large`, the payer SHOULD ask again with a shorter reply path
    before it asks in a large onion message.
- Any other invoice error is the recipient not supporting the menu.

When there is no menu, the payer SHOULD still let its user pay the support
offer with an amount they choose. The payer MUST ignore a `support_menu`
record in a reply to a request to pay.

Menus can list each other, so they can form loops. Asking for a menu does
not change anything for the recipient, so a loop only shows the same offers
again.

#### Signing a Page

The `signature` is a BIP 340 signature by the key of the `offer_issuer_id`
of the support offer, with the x coordinate of `offer_issuer_id` as the
BIP 340 public key, of:

```
menu_hash = SHA256(SHA256(tag) || SHA256(tag) || chain_hash ||
  offer_issuer_id || service_id || menu)
```

where `tag` is `support-menu-signature`, `chain_hash` is the 32 byte hash
that names the network of the support offer in `offer_chains`, even when the
support offer leaves `offer_chains` out, `offer_issuer_id` is the 33 byte
`offer_issuer_id` of the support offer, `service_id` is its 16 byte
`service_id`, and `menu` is the `support_menu` value as it was received,
with the bytes of its `signature` record taken out and nothing else changed.
Records that the reader does not know are part of `menu`, so the reader
MUST NOT leave out, reorder, or encode again any other record when it checks
the signature.

A page is signed when `signature` is 64 bytes and is a valid signature of
`menu_hash` by the `offer_issuer_id` of the support offer.

The network, `offer_issuer_id`, and `service_id` of a support offer stay the
same when it changes, so a page is the menu of every version of the support
offer, and of no other offer. The text of the support offer is not signed
with its pages, so a reader MUST NOT show the text of the support offer as
signed because its pages are.

The signature shows that the recipient listed each entry exactly as it is.
It does not show that the holder of the `offer_issuer_id` of an entry wrote
it, when that is not the recipient: BOLT 12 offers are not signed, so the
text of such an entry is only what the recipient says, until its issuer
signs an invoice for it, which repeats the offer's records.

Someone who answers menu requests for the recipient, like a service that
holds invoices for a recipient that is offline, MUST send pages that the
recipient signed, without changing them.

## Rationale

**Why levels?** Most of what a wallet gains is at level 1, which needs no new
messages. A recipient can suggest amounts at level 0, with no new behavior
at all, and at level 1 only adds a label to its offer and takes care with
its replies. Levels let each side start small, and let a wallet and a
recipient at different levels still work together.

**Why suggested amounts in the offer?** A wallet can show them as soon as it
reads the offer, with no request to the recipient. Every offer carries its
own, so an offer on a menu suggests amounts the same way as an offer found
anywhere else.

**Why only for offers with a network?** Suggested amounts are paid in
millisatoshis. An offer for one Bitcoin network is paid in millisatoshis of
that network, so the amounts, or what a payer converts them to, mean one
thing.

**Why a currency?** People often think of support in the currency they
use, and an amount like five dollars keeps its meaning as exchange rates
change, where an amount in millisatoshis does not. BOLT 12 does the same for
`offer_amount` with `offer_currency`, but an offer cannot use
`offer_currency` without `offer_amount`, since BOLT 12 has readers not
respond to such an offer. The currency is in the same record as the
amounts, so that a reader never reads amounts in a currency as
millisatoshis. With `offer_currency`, the amount is the recipient's price,
and the recipient's invoice says what it is in millisatoshis. A suggested
amount is only a hint, and the amount is the payer's choice, so the payer
converts it.

**Why no amounts in millisatoshis beside a currency?** A wallet without an
exchange rate cannot use amounts in a currency, and amounts in millisatoshis
beside them would give it something to show. But the two lists would only
agree at the exchange rate when the offer was made, and an offer can be
printed and paid for years, so the lists would drift apart as rates change,
and wallets would suggest different amounts for the same offer. A wallet
without a rate shows no suggested amounts, and its user still chooses an
amount.

**Why label the offer in its own record?** BOLT 12 reflects the whole offer
in an invoice request so that the offer node can be stateless, and
`offer_metadata` is where it can keep a cookie to check the other fields.
A label in its own record leaves `offer_metadata` to the issuer. The record
is odd, so wallets that do not know it ignore it, and BOLT 12 has payers
copy all offer records into their invoice requests, so the recipient sees
the label too. A wallet only asks for the menu of an offer with the label,
so recipients that do not know menus are not sent menu requests, which they
would answer with invoices that are never paid.

**Why one version number?** Readers only need to know if they can
understand a label. Changes they can ignore are new odd records, so a
single number for changes they cannot ignore is enough, and it says less
about the software that made the offer.

**Why a service id?** The fields of a support offer change over time: its
paths are replaced, and its description and suggested amounts are edited.
Each change makes a new offer, with other bytes. A `service_id` lets a
wallet, a menu, or a recipient know the new offer as the same support
offer, and tells apart the support offers of one issuer, which an
`offer_issuer_id` alone cannot.

**Why with the `offer_issuer_id`?** BOLT 12 offers are not signed, so anyone
can copy a `service_id` into an offer of their own. Only the holder of an
`offer_issuer_id` can sign the invoices and menu pages of its offers, so a
`service_id` only means something together with its `offer_issuer_id`, and
a changed offer is only the issuer's once the issuer signs for it.

**Why with the network?** Payments on different networks are not the same
money, and suggested amounts are millisatoshis of the offer's network. An
issuer can use one `offer_issuer_id` on more than one network, so offers on
different networks are different support offers, and payments to them are
never shown together as one.

**Why a sequence?** The issuer signs invoices for old versions of a support
offer too, so a signature alone does not say which version is newer. A number
that only goes up lets a reader keep the newest version that it has seen, and
never go back to an older one. A reader only takes a higher number from an offer
that the issuer signed for, or, until the issuer has signed for the support
offer, from one that it got the way that it got the first, since anyone can make
an offer with a higher number, and a reader that took one from them could never
take the real updates. Once the issuer has signed for the support offer, the way
that the reader got an offer is no longer enough, as "Why does authentication
only go one way?" explains. For the same reason, the number of an offer that a
reader has never authenticated does not keep out one that the issuer signed for,
even when the reader got it from a name: whoever publishes the name could have
given it any number, like 999 for a support offer whose real version is 2.

**Why is the sequence a generation?** A support offer can have copies that
differ only in their paths, like a copy for each place that shows it, and
its paths are replaced when they stop working. A sequence for each copy
would make every other copy look older than the newest one, and a reader
could not tell an old copy from a current one with other paths. With a
generation, copies with other paths share a `service_sequence`, so a reader
can keep copies of one generation and use any of them, and new paths do
not need a new generation. Any other change is a new generation, since a
reader that kept two copies with other text would not know which to show.

**Why does authentication only go one way?** Getting an offer the way that the
reader got the first, like from a BIP 353 name, shows only what was published
there: a DNSSEC proof authenticates what the name's domain published, and not
the offer in it, and a resolver can have stale records. That is enough to follow
updates before the issuer has signed for the support offer, but once it has,
taking an offer that it did not sign would let whoever controls the domain
replace what the issuer signed, or add copies with paths of their own. So once a
reader has kept an authenticated copy, only authenticated offers replace it or
join it.

**Why can a label only add to an offer?** Wallets that do not know a label
pay the offer as a normal offer. That is only safe when paying it as a
normal offer is what its recipient expects. BOLT 12 has readers refuse an
offer with an unknown even record, so a service that needs something else
can make older wallets refuse its offers instead of paying them the wrong
way.

**Why pay offers with unknown labels as normal offers?** A label only adds
to an offer, and a service that changes how its offers are paid puts an
even record in them, which BOLT 12 readers refuse. So paying an offer with a
label that a reader does not know as a normal offer is safe wherever the
reader finds it, and a wallet treats an offer the same way whether it is
scanned, listed on a menu, or sent as a payer offer.

**Why no amount, currency, or quantity?** The supporter chooses the amount,
and a quantity only multiplies an amount. Treating a labeled offer that has
one of those as a normal offer keeps menu requests and suggested amounts
unambiguous.

**Why is `offer_issuer_id` required?** Without it, BOLT 12 has invoices
signed by the key at the end of the blinded path that the request arrived
on, so the recipient's identity is tied to its paths. A support offer can
be paid again and again, and its paths may need replacing in that time.
With an `offer_issuer_id`, the recipient can publish the offer again with
new paths, and payers can see that it is the same recipient. The menu is
also signed by it.

**Why are `offer_paths` required?** BOLT 12 has an offer without paths
reached at its `offer_issuer_id`, which then has to be the recipient's node.
With paths, the `offer_issuer_id` can be a key of its own, and the node
stays private. Requests for the support offer arrive on its paths, as BOLT
12 checks for every invoice request, and the offers that a menu lists
without their paths are reached over the same paths.

**Why not put the menu in the offer?** Every invoice request repeats the
whole offer, and every invoice repeats its request, so a menu in the offer
would make every payment larger, and work against Reply Size. An offer with
the offers of a menu in it would also be too large to print or scan, and an
offer cannot change once it is printed or published, so its menu could never
change either. A menu that is asked for can be as long as it needs to be,
and can change, and payers only ask for it when they want to see it.

**Why a record in the invoice request?** A menu request is an ordinary
signed BOLT 12 invoice request that reaches the recipient over the same
paths as a payment, so it needs no new message type and no change to
BOLT 12. The record says what the payer wants, instead of relying on a field
being left out. A recipient that does not know the record makes an invoice,
which the payer does not pay.

**Why not an onion message record of its own?** A menu could be asked for
with an odd `onionmsg_tlv` record of its own, outside of invoice requests,
which some node interfaces make easy to send. It would need its own way to
reach the recipient, to tie a request to an offer, and to sign requests, and
the software that answers invoice requests for an offer, like a service that
holds invoices for a recipient that is offline, would not answer it. An
invoice request already reaches the recipient over the offer paths, names
the offer, and is signed, so a menu request inherits all of that from
BOLT 12.

**Why a fixed amount?** BOLT 12 requires an amount in a request for an offer
without one, and the amount of a menu request is not used. A fixed amount
that recipients do not check means a menu request is never turned down for
its amount, and that menu requests all look the same.

**Why an invoice error?** The reply to an invoice request is an invoice or
an invoice error. No invoice is made for a menu request, and the page goes
in an odd record, which other readers of invoice errors ignore.

**Why pages?** A page of up to 768 bytes fits in an onion message of the
regular size, with room for a reply path of a few hops, so a reply is never
much larger than its request, and menus do not need large onion messages,
which stand out and cost every node that relays them. Pages depend only on
the menu, not on the request, so the recipient can sign all of them ahead
of time. A page holds several offers listed without their paths or as
references, but often only one whole offer with paths, so a menu of many
offers takes several pages, and a payer only asks for more when it wants to
see more.

**Why offers without their paths?** Most of an offer is its blinded paths,
hundreds of bytes for each. An offer of the recipient can be reached over
the paths of the support offer, so an entry for it leaves its paths out,
and a page holds several such entries instead of one or two whole offers.
The paths of the support offer are the ones that the payer has, so they
are the ones that it already uses to reach the recipient. A support offer
listed without its paths can have a menu of its own, which is asked for
over the same paths, so the recipient answers its menu requests there too.

**Why references on a menu?** An offer of someone else cannot be reached
over the paths of the support offer. A reference to it is a name, a key,
and an id, much smaller than the offer, and the offer found at the name is
the current one, with current paths.

**Why is every page signed?** The menu comes from whoever answers on the
offer paths. Without a signature, anyone who can answer there, or who
publishes an offer with the recipient's `offer_issuer_id` and paths of their
own, could list offers that pay them under the recipient's name. A signature
by `offer_issuer_id` shows that the recipient listed the entries, and a
service that answers for a recipient that is offline can send pages that
the recipient signed ahead of time.

**Why is the signature bound to the identity of the support offer?** The
network, `offer_issuer_id`, and `service_id` of the support offer are signed
with the page, so a page cannot be shown as the menu of another support
offer, even another of the same recipient. They stay the same when the
offer changes, so one set of pages is the menu of every version of the
support offer, and of every copy with other paths, like an offer with new
paths for each place that shows it. The text of the support offer is not
signed with the page, but BOLT 12 offers are not signed, so its text is only
what the offer says either way.

**Why does a page have an expiry?** A signed page shows that the recipient made
it, but anyone who has it can send it again, even after the recipient changes
its menu. An expiry that is signed with the page limits how long an old page can
be shown, and lets a payer keep a page until then instead of asking again. A
page without one could be shown forever, so a reader does not use it, even when
it is signed. Menus have no sequence, so this expiry, and not an order of menus,
is what limits rollback to an older menu. A page is asked for when it is used,
and is the menu of every version of the support offer, so readers do not keep
menus to compare, and a sequence would only protect a reader that had already
seen a newer menu.

**Why a menu id?** Each page is signed on its own. Without something to tie
pages together, pages of two menus that have not expired could be put
together into a list that the recipient never made, like the first page of
one menu with the second page of the other. The `menu_id` is signed with
each page, so a page can only be used with pages of the same menu. A menu
id that stays the same when the same pages are signed again means that a
payer who asks for a page after the recipient signs its pages again still
gets a page of the same menu. A `menu_id` that is a hash of the contents of
the menu, or random, is never the same for two different menus, so a writer
does not have to keep track of the menu ids that it used before. A hash
gives the same `menu_id` to the same contents, which is safe, since pages
with the same contents can be used together.

**Why not ask for a page of a menu id?** The recipient would have to keep
old menus to answer. A payer that gets a page of another menu can ask again
from the first page.

**Why does the signature cover unknown records?** New records are then
signed too, so they cannot be changed or added by anyone else, even for
readers that do not know them. It means that a reader checks the bytes it
received, not a page that it makes again from the records that it knows.

**Why not a BOLT 12 merkle signature?** BOLT 12 signs a merkle tree of its
records so that records can be left out later without breaking the
signature. A page is only ever read whole, so a hash of it is enough.

**Why one Bitcoin network?** Every offer on a menu has to be payable where
the payer pays the support offer. A support offer with one network
makes that one check for each entry, and keeps menus to Bitcoin networks.

**Why does `offer_issuer_id` decide who an entry pays?** BOLT 12 has the
payer check that an invoice is signed by the `offer_issuer_id` of its offer.
An entry with the same `offer_issuer_id` as the support offer pays the
same recipient, and an entry with another pays someone else, even when the
recipient lists it.

**Why entries with their own TLV streams?** Each entry can gain new fields,
like a label or an image, as new odd types, without changing how the list is
read. An entry that a reader cannot use is left out without losing the
others.

**Why offer bytes and not offer strings?** A page has to fit in an onion
message, and offer bytes are smaller than offer strings.

**Why can a payer send an offer?** A supporter might want to be supported
back, or to be known to the recipient. Sending an offer that it is
authorized to present, and that the recipient can pay, does both, when the
payer wants it to.

**Why is a payer offer signed?** Without a signature, anyone could send
someone else's offer. A signature by its `offer_issuer_id`, the key that
signs its invoices, shows that the holder of that key authorized the holder
of the `invreq_payer_id` key that it covers to present the payer offer. The
signature covers the network, that `invreq_payer_id`, and the payer offer,
but not the recipient, the particular support offer, or anything else in the
request: the holder of the `invreq_payer_id` key chooses those, and signs
them in the request.
That key signs the whole request, so only its holder can put the payer offer
in a request, and a recipient cannot move it to a request of its own. The
two keys do not have to be held by the same person: the holder of an offer
can authorize a payer who is someone else. The signature also covers every
other record of the payer offer, so a record added later is signed by the
holder of the offer too. An offer without an `offer_issuer_id` has no one
key to sign with.

**Why a reference?** An offer with blinded paths is hundreds of bytes, and
the invoice copies it, so a request with a whole offer, and its invoice,
often need large onion messages. A reference is a name, a key, and an id,
about 120 to 150 bytes. With a reference, the invoice for a request can
still fit in an onion message of the regular size, when it has one payment
path and the reply path is short. The offer found at the name is the
current one, with current paths. A reference needs a BIP 353 name, so a
payer without one sends the whole offer.

**Why an issuer id in a reference?** Anyone can sign a reference to any name
with a key of their own. The `issuer_id` lets a recipient check the
signature before it looks anything up, and binds the name to the key: only
an offer found at the name with that `offer_issuer_id` is used.

**Why can a payer offer expire?** The signature of a payer offer covers an
`invreq_payer_id`, not a time, so without an expiry, the holder of that key
can present the payer offer for as long as it holds the key. When the
holder of an offer authorizes a payer who is someone else, an `expiry`
signed with the payer offer limits the authorization to a time.

**Why is the network signed with a payer offer?** A reference has no network of
its own: it is for the network of the support offer that its request pays, and
the same name and `issuer_id` can lead to another offer on another network.
Signing the chain hash binds a payer offer to that network, so a payer offer
seen with a request on one network cannot be presented with a request on
another, like from testnet on bitcoin. A whole offer names its own networks, but
is signed the same way, so that every payer offer is checked alike. A page is
signed with the network of its support offer, so its references are bound to it
too.

**Why a sequence in a reference?** A reference finds the offer at a name,
and the name can serve an older version of a support offer: a resolver can
have stale records, a DNSSEC proof is valid until its signatures expire,
and whoever controls the name can publish any version. A reader that sees
the support offer for the first time has nothing to compare it with. A
`service_sequence` signed with the reference is a floor, so a reader does
not use a version older than the one that the signer knew of. Pages are
signed again often, and payer offers for each request, so the floor stays
recent. A version published after the reference was signed can still be
rolled back to the floor, and a reader that keeps the support offer never
goes back from the version that it keeps. An offer that is not a support
offer has no sequence, so a reference without a `service_id` is to whatever
offer is at the name.

**Why look up names only once paid?** A request to pay is free to send, and
a lookup reaches the servers of a domain that the payer chooses. Looking up
names only for requests that were paid means that requests alone do not
make the recipient look anything up, and that each lookup costs the payer a
payment.

**Why are replies no larger than requests?** Requests are free to send, and
the reply path is the requester's choice. An invoice is a few hundred bytes
larger than its request, so a request that just fits in an onion message of
the regular size can have an invoice that does not. Sending that invoice in
a large onion message would make every node on the reply path relay about
24 times what the requester sent. With replies no larger than their
requests, a requester that wants a large reply sends a large request, like
a payer that sends a whole offer. A recipient can usually make an invoice
fit by leaving out payment paths. Some node interfaces give an application
an invoice request without the size of the onion message that it arrived
in, so a recipient that does not know the size treats the request as one of
the regular size, which is never larger than the request. Such a recipient
never sends a large reply, so a request that it cannot answer in one of the
regular size is always declined, and a payer with a payer offer that makes
the invoice too large pays again without it.

**Why a `reply_too_large` record?** A payer that sends a request again in a
large onion message makes every node on the path relay about 24 times as
much, so it only does that when it knows that a large reply could help. Any
invoice error could mean that, or something else, like an expired offer or
a limit of the recipient, and an error string is free text. An empty odd
record says it plainly, and readers of invoice errors that do not know it
ignore it.

**Why a support note?** Supporters like to be thanked, and a recipient might
want to give something back, like a link or a code. BOLT 12 invoices have
no text of the recipient's own, and BOLT 12 has no message from the
recipient after a payment, so the note goes in the invoice, where the
invoice signature shows that the recipient wrote it.

**Why seal the note to the payment preimage?** An invoice arrives before
the payment, and requests are free to send, so anyone could read a note in
the clear without paying. The payer only learns the preimage when the
payment settles, so a note sealed to it can only be read by a payer that
paid. The nodes on the payment route learn the preimage too, but they do
not see the invoice, which goes over onion messages, unless one of them also
answers invoice requests for the recipient.

**Why a salt?** ChaCha20-Poly1305 is only safe when a key and a nonce never
seal two different texts. With a new random salt in the key of each note,
each note has a key of its own, so a nonce of zeros is never used twice
with a key, even when a recipient seals a note again for an invoice that it
sends again, or uses a payment preimage twice by mistake, and a recipient
does not have to keep track of the notes that it sealed before. A random
nonce under one key for each preimage would also work, and be 4 bytes
smaller, but a 16 byte salt makes a repeat even less likely, and gives each
note a key of its own.

**Why can a note depend on the request?** A recipient might want to thank a
larger payment more, answer a payer note, or greet a payer that sent an
offer. Each request has its own invoice and payment preimage, so each can
have a note of its own. A note cannot depend on how the payment goes, since
it is in the invoice, which is made before the payment.

**Why these type numbers?** `offer_service`, `offer_suggested_amounts`,
`invreq_support_menu`, `invreq_payer_offer`, and `invoice_support_note` are
odd and in the BOLT 12 experimental ranges for offer, invoice request, and
invoice records, so they do not collide with types that BOLT 12 defines.
`invoice_error` has no experimental range, so `support_menu` and
`reply_too_large` are odd and far from the types BOLT 12 defines. The types
will not change, so offers that are printed keep working.

## Backwards Compatibility

A support offer is a valid BOLT 12 offer. Wallets that do not know
`offer_service` or `offer_suggested_amounts` ignore them, copy them into
their invoice requests as BOLT 12 requires, and pay the offer as normal.
They never set `invreq_support_menu`, so they never receive a menu. A
recipient that does not know `invreq_support_menu` treats a menu request
as a request to pay and sends an invoice, which the payer does not pay.
Readers of invoice errors ignore the odd `support_menu` and
`reply_too_large` records. A recipient
that does not know `invreq_payer_offer` ignores it, and copies it into its
invoice as BOLT 12 requires. A payer that does not know
`invoice_support_note` ignores it, since it is odd, and pays the invoice as
normal.

Wallets that do not know this document send their invoice requests in
onion messages of the regular size, and do not send them again in large
ones, so they can only pay a support offer whose invoice fits in one. That
is why a writer keeps a support offer small, and a recipient leaves out
payment paths to make an invoice fit.

A menu can list offers of later versions and other services. A reader that
does not support them pays them as normal offers, and does not ask for
their menus.

## Security and Privacy Considerations

**Menus are the recipient's.** Every page is signed by the `offer_issuer_id`
of the support offer, so the entries on a page are exactly the ones that
the recipient listed. Only an entry with the same `offer_issuer_id` pays the
recipient, and when the entry has the offer in it, the signature shows that
the recipient wrote it. For a reference, the page signs only the reference,
and the offer found at the name is only what was published there, which can
change after the page is signed.
A name that the payer used to find the support offer, like a human readable
name, says nothing about entries with another `offer_issuer_id`.

**Offers of other issuers.** BOLT 12 offers are not signed, so a recipient
can list an offer with anyone's `offer_issuer_id` and text of its own. The
signature of the page shows that the recipient listed it, not that the
holder of that `offer_issuer_id` wrote it. The offer can only be paid when
the holder of that key answers its invoice requests, and the invoice it
signs repeats the offer's records. Until then, the text of the entry is only
what the recipient says. An entry that is a reference names where to find
the offer instead, and a reader only uses an offer found there with the
`offer_issuer_id` of the reference.

**Issuer keys.** A support offer cannot move to another `offer_issuer_id`.
When the key of an `offer_issuer_id` is lost, or leaks, its recipient has to
publish a new support offer, and payers find it the way that they found the
first, like by a human readable name. Whoever has a leaked key can make
invoices and menu pages for the support offers of that key until payers
stop using them.

**Changed offers.** Anyone can make an offer with the `offer_issuer_id` and
`service_id` of a support offer, and other text, other paths, or a higher
`service_sequence`. It cannot be paid unless the holder of that
`offer_issuer_id` answers for it, but a reader that replaced a support offer
that it keeps with it could show the wrong text, or no longer reach the
recipient, and one with a higher `service_sequence` would also keep it from
taking the real updates. A reader that only replaces a support offer once its
issuer signs for the new one, or once it gets the new one the way that it got
the first, when that way shows who published it, avoids that. Once a reader has
kept a support offer that its issuer signed for, taking only offers that the
issuer signed for also keeps whoever controls a name from undoing what the
issuer signed. The issuer has signed older versions too, in their invoices, so a
reader that only replaces a support offer with one of a higher
`service_sequence` also never goes back to an older version. The first support
offer that a reader keeps can come from anyone, like from a code that was
swapped, or from a name whose publisher made it up, and could have the highest
`service_sequence` there is. So until a reader has kept a support offer that its
issuer signed for, it can replace the support offer with one that is
authenticated, whatever its `service_sequence` and however it got the first, and
only after that does it need a higher `service_sequence`.

**Copies of a support offer.** A page is signed for the network,
`offer_issuer_id`, and `service_id` of a support offer, so a copy of the
support offer with other paths gets the same menu, and its entries without
paths are reached over the paths of the copy. The page does not sign those
paths, so an entry without paths only covers its offer, for a reader, when
the copy whose paths it put in is authenticated. Whoever answers on those paths
sees the invoice requests for them, but still cannot sign their invoices.
Those requests can have an `invreq_payer_note` and an `invreq_payer_offer`,
which the copier learns, just as it would for a copy of any BOLT 12 offer.
A payer offer is signed for the `invreq_payer_id` of its request, so the
copier cannot present it in a request of its own. The text of the copy is
not signed with the pages, so a genuine menu says nothing about the text of
the support offer that it is shown with.

**Old pages.** Anyone who has a page can send it again until its
`absolute_expiry`, so an older page can be shown for a while after the recipient
changes its menu. Menus have no sequence, unlike support offers, so
`absolute_expiry` is the only limit on this rollback. A shorter expiry makes
that time shorter, and a longer one, like for a recipient that is often offline,
makes it longer.

**Mixed pages.** Pages are signed one at a time, so anyone who has pages of
more than one menu can send a payer a page of one menu when it asks for a
page of another. A reader that only uses pages together when they have the
same `menu_id` never shows a list that the recipient did not make.

**Forged replies.** The `path_id` of the reply path is what shows that a
reply came from whoever received the request. Someone who can guess it can
send a reply of their own, and a reply path that is used for more than one
request lets the recipient of one request answer another. A forged page
still needs the recipient's signature to be used.

**Amplification.** A recipient never replies in a larger onion message than
the request, so a request that is free to send cannot make the nodes on its
reply path relay a large onion message unless it is one. A reply path can
pass through the same node more than once, which has that node relay the
reply more than once. Recipients can decline requests with reply paths of
many hops, and can limit how many requests they answer, since BOLT 4 lets a
node drop onion messages.

**Request limits.** Menu requests are free to send. A recipient that limits
menu requests apart from requests to pay keeps menu requests from using up
the requests to pay that it answers.

**Fingerprinting.** The label is public. It shows that an offer is a
support offer and which version made it, which can identify the software
that the recipient uses.

**Recipient privacy.** Offer paths that start at another node and an
`offer_issuer_id` that is not the recipient's node id help keep the
receiving node private. An offer path that starts at the recipient, or an
`offer_issuer_id` that is its node id, reveals it. Offers that share an
`offer_issuer_id` can be linked to each other, and offers that also share a
`service_id` are known as changes of one support offer, which is what a
`service_id` is for. A `service_id` is random, so it shows nothing else.
Offers on a menu without their paths are reached over the paths of the
support offer, which only shows what their shared `offer_issuer_id` already
shows.

**Human readable names.** When a payer found the offer with a human readable
name, BOLT 12 has it put the name in its invoice requests, menu requests
included, so the recipient learns which name was used to find the offer.
That matters when the same offer is published under several names.

**Payer privacy.** BOLT 12 asks for a transient `invreq_payer_id`. A payer
that uses a new `invreq_payer_id` and `invreq_metadata` for each request, as
this document requires for menu requests, keeps its requests from being
linked by them. A reply path that starts at the payer's node reveals the
node to the recipient. Requests can still be linked in other ways, like the
timing of a menu request and the payment that follows it. Pages are the
same for every payer, but a recipient can change its pages often, or give
its offers their own paths, to link a menu request to the payment for an
offer on it that follows.

**References.** A BIP 353 DNSSEC proof authenticates the payment instructions
that the name's domain published, and not the offer in them: BOLT 12 offers are
not signed, so a domain can publish an offer with anyone's `offer_issuer_id`. An
offer found at a name, with a valid DNSSEC proof, shows that the domain
published it there, and not that the holder of its `offer_issuer_id` authorized
that name. Whether that holder authorized the name depends on who signed the
reference:

- A payer offer that is a reference is signed by the holder of its `issuer_id`,
    so that holder authorized the name.
- A menu entry that is a reference with the `issuer_id` of the support offer of
    the menu is signed with the page by the holder of that same key, so that
    holder authorized the name too.
- A menu entry that is a reference with another `issuer_id` only shows that the
    recipient listed the name. It does not show that the holder of that
    `issuer_id` authorized the name, or uses it.

In each case, the offer found at the name is only what the domain published. An
invoice for it can still only be signed by the holder of its `offer_issuer_id`,
but its text is not signed by anyone until then. The name can also serve an
older version of a support offer, like from stale records. A reference with a
`service_sequence` keeps a reader from using a version older than the one that
the signer knew of, but not from using one between that and the newest. A
reference without a `service_id` has no such floor, and leads to whatever offer
with its `issuer_id` is at the name.

**Name lookups.** A lookup of the name of a reference reaches the servers of
the name's domain, and whoever chose the name can choose a domain whose
servers it runs, and a name that it uses only once: the payer, for a payer
offer, and the recipient, for a menu entry. Those servers then learn when
the name was looked up and from where: the IP address of the reader when it
looks up names itself, or of the resolver that it uses. For a recipient,
that can reveal the node that it keeps private with its offer paths and its
`offer_issuer_id`, and for a payer, it can reveal who is looking at the
menu. Checking the signature of a payer offer first does not prevent this,
since anyone can sign a reference with a key of their own, and waiting to
look up a name does not either, since a name used only once ties the lookup
to what named it. A lookup over Tor, or a DNSSEC proof asked for over onion
messages, does not show the IP address of the reader. A resolver that many
others use shows its own address instead, but that can still show who
provides the reader's connection, and some resolvers pass on part of the
address of whoever asked. Any resolver also learns the names that the
reader looks up. A recipient that only looks up names once requests are
paid makes each lookup cost a payment, though a small one, since the payer
chooses the amount, and a payer that only looks up a name when it chooses
an entry looks up only the names that it wants.

**Payer offers.** A payer offer links the payment to the offer, and to every
other payment that sends it. Its signature can also be shown to others: with the
invoice request, it shows that the holder of the offer's `offer_issuer_id`
authorized the holder of the `invreq_payer_id` key to present the payer offer,
and that the holder of that key presented it in a request to pay the recipient.
The signature of the offer's issuer does not name the recipient or the payment.
It does not show that the two keys are held by the same person, or who paid. A
payer only sends a payer offer when it wants the recipient to know about the
offer. A payer offer with paths that start at the payer's node reveals that node
to the recipient. The authorization names no recipient: whoever holds the
`invreq_payer_id` key can present the payer offer in any request that it signs,
until its `expiry`, or, without one, for as long as it holds the key. A
recipient that paid every payer offer that it was sent could be made to pay any
offer by anyone who pays it a little, so a recipient only pays one when its user
chooses to.

**Support notes.** A support note can only be read with the payment
preimage. The payer learns the preimage when its payment settles, and so do
the nodes on the payment route, but those nodes do not see the invoice, so
they cannot read the note. A node that answers invoice requests for the
recipient, like a service that holds invoices for a recipient that is
offline, and that is also on the payment route, sees both, and can read it.
A recipient that used one preimage in invoices for more than one request
would let a payer that asks for several of them, and pays the smallest, read
the notes of all of them. A payer can show the note and the preimage to
anyone, so a note is not a secret once it is paid for: a code in a note is a
code for whoever the payer gives it to. The note is set when the invoice is
made, so it cannot depend on how the payment goes. The length of a sealed
note shows the length of the note, so notes of different lengths, like a
thank-you and a code, can be told apart without being opened. A note is text
from the recipient, so a wallet that showed it as its own text would let the
recipient speak for the wallet.

## Future Work

- A support offer cannot move to another `offer_issuer_id`. A handoff signed by
    the old key could let payers follow the recipient to a new key.
- Recurring support, like a payment each month, is out of scope. It could use a
    future BOLT 12 recurrence mechanism, if one is standardized.
- Menu entries and pages could gain odd records for an image or a funding goal,
    which would need no new version.

## Test Vectors

The keys in these vectors are made from secrets of 32 repeated bytes:

| Secret | Use | Public Key |
|--------|-----|------------|
| `01` | Issuer of the support offer and the episode offer | `031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f` |
| `02` | Issuer of the guest offer | `024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766` |
| `04` | Payer | `03462779ad4aad39514614751a71085f2f10e1c7a593e4e030efb5b8721ce55b0b` |
| `05` | Recipient node | `0362c0a046dacce86ddd0343c6d3c7c79c2208ba0d9c9cf24a6d046d21d21f90f7` |
| `06` | Introduction node of the offer paths | `03f006a18d5653c4edf5391ff23a61f03ff83d237e880ee61187fa9f379a028e0a` |

Hex is split into lines at the start of each record or field. Join the lines
to get the bytes.

### Suggested Amounts

1,000,000 and 5,000,000 millisatoshis, as an `offer_suggested_amounts`
record:

```
fe3ba715af12
0010
00000000000f4240
00000000004c4b40
```

- `fe3ba715af 12`: `offer_suggested_amounts`, type `1000805807`, 18 bytes
- `00 10 ...`: `amounts`, 16 bytes, two amounts

5 and 20 US dollars, as an `offer_suggested_amounts` record of 500 and 2,000
cents, since the ISO 4217 exponent of USD is 2:

```
fe3ba715af17
0010
00000000000001f4
00000000000007d0
0203555344
```

- `fe3ba715af 17`: `offer_suggested_amounts`, type `1000805807`, 23 bytes
- `00 10 ...`: `amounts`, 16 bytes, two amounts
- `02 03 555344`: `currency`, `USD`

An offer with those suggested amounts. A reader MUST read them as amounts
in USD, and converts the one that the payer chooses to millisatoshis:

```
lno1pgr4g6tsyp4xzuskyyp3hpx92ea3yezqn9wna4d2hgzkt4c7rq6xqjqel7wp0a0f+
6hws0rl78wn3ttchqqgqqqqqqqqqqq05qqqqqqqqqqraqqsr24f5g
```

A reader MUST ignore the suggested amount in this offer, since it has an
amount of 9,000,000 millisatoshis:

```
lno1pqpcj4zqpg95yateypsjqurjd9h8g93pqvdcf32k0vfxgsyet5ldt246q4jaw8sc+
x3sysx0lnstlt6w4m5rcll3m5u267zsqpqqqqqqqqzvfdqq
```

A reader MUST ignore the suggested amounts in this offer, since its
`amounts` are 9 bytes long:

```
lno1pgr4g6tsyp4xzuskyyp3hpx92ea3yezqn9wna4d2hgzkt4c7rq6xqjqel7wp0a0f+
6hws0rl78wn3ttctqqysqqqqqqqq7sjqqq
```

A reader MUST ignore the suggested amounts in this offer, since one of them
is `0`:

```
lno1pgr4g6tsyp4xzuskyyp3hpx92ea3yezqn9wna4d2hgzkt4c7rq6xqjqel7wp0a0f+
6hws0rl78wn3ttcjqqgqqqqqqqqq7sjqqqqqqqqqqqqqq
```

A reader MUST ignore the suggested amounts in this offer, since its
`amounts` are empty:

```
lno1pgr4g6tsyp4xzuskyyp3hpx92ea3yezqn9wna4d2hgzkt4c7rq6xqjqel7wp0a0f+
6hws0rl78wn3ttczqqqq
```

A reader MUST ignore the suggested amounts in this offer, since its
`currency` is `usd`, which is not uppercase:

```
lno1pgr4g6tsyp4xzuskyyp3hpx92ea3yezqn9wna4d2hgzkt4c7rq6xqjqel7wp0a0f+
6hws0rl78wn3ttc0qqyqqqqqqqqqqq05qgph2umy
```

A reader MUST ignore the suggested amounts in this offer, since they have
an unknown even record, type `4`:

```
lno1pgr4g6tsyp4xzuskyyp3hpx92ea3yezqn9wna4d2hgzkt4c7rq6xqjqel7wp0a0f+
6hws0rl78wn3ttcdqqyqqqqqqqqq7sjqqsqsq
```

A reader MUST ignore the suggested amounts in this offer, since it is for
two networks, testnet3 and signet, and so does not have a network:

```
lno1qfqyxjtl6luzd9t3pr62xr7eemp6awnejusgf6gw45q75vcfqqqqqq8krmhrkcar+
szj80grr4uet9w7f0j0lnuql93pzt6tnnzqssqqqqq9qw4rfwqsx5ctjzcssxxuyc4t8+
kynygzv460k442aq2ewhrcvrgczgr8lec9l4a82a6pu0lca6w9d0pgqqsqqqqqqqqr6z+
gq
```

### Service Label

Support, version `1`, with a `service_id` of 16 `0d` bytes:

```
000101
020101
04100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
```

- `00 01 01`: `service_type` `1`
- `02 01 01`: `service_version` `1`
- `04 10 ...`: `service_id`, 16 bytes

As an `offer_service` record:

```
fe3ba715ad18
00010102010104100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
```

- `fe3ba715ad`: type `1000805805`
- `18`: 24 bytes

A reader MUST treat an offer with this label as not labeled, since
`service_type` has a leading zero byte and is not a minimal `tu64`:

```
00020001
020101
```

A reader MUST treat an offer with this label as not labeled, since its
`service_id` is 15 bytes:

```
000101
020101
040f0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
```

A reader MUST ignore the unknown odd record in this label, type `5`, and
read it as support, version `1`, with its `service_id`:

```
000101
020101
04100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
050100
```

Support, version `1`, with the `service_id` above and a `service_sequence`
of `1`:

```
000101
020101
04100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
060101
```

- `06 01 01`: `service_sequence` `1`

A reader MUST treat an offer with this label as not labeled, since its
`service_sequence` has a leading zero byte and is not a minimal `tu64`:

```
000101
020101
04100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
06020001
```

A reader MUST treat an offer with this label as a normal offer, since its
version is `2`:

```
000101
020102
```

### Support Offer

An offer with the description `Support my work`, one offer path, the label
above, and suggested amounts of 1,000,000 and 5,000,000 millisatoshis. The
path starts at the introduction node and ends at the recipient, with a path
key made from the secret `07`. Before it is encrypted, the data for the
introduction node is padding and the recipient's node id as `next_node_id`,
and the data for the recipient is padding and a `path_id` of 32 `0a` bytes.
Each line is the data for one hop:

```
010004210362c0a046dacce86ddd0343c6d3c7c79c2208ba0d9c9cf24a6d046d21d21f90f7
01010006200a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a
```

The offer, split with `+` as BOLT 12 allows:

```
lno1pg84xatswphhyapqd4ujqam0wf43pucr7qr2rr2k20zwmaferler5c0s8lur6gm7+
3q8wvyv8l20n0xsz3c9q9xyupdmvk43ew87un0hnrmqxcdtq7vjf6mhfuhvrc4mz2ktw+
qhm0qgp403e5fxxpm0nse7umwz6adljj9mvwsk7k6rlrnnuwk0rgt40lv0gqxkq7r5yj+
cfvgxen8h2pa62fzlqzmu0hk0j52fdf4mnjg6h95a05mwc5r79mwmk30u8q4xs09at0j+
0ldxw5t92nczc8c07jmkhymqvg2ysnjq4rdcqmvy4hgnnvq27x7yhepxt2ldm7lsqd07+
3snaw6ypj3plcmpphul7cup29klguzkxk63zupnt6g4xzydl2twhvpyzrfy5rvfvp9p9+
jku67j0d326h7953vggrrwzv24nmzfjypx2a8m264ws9vht3uxp5vpypnluuzl67n4wa+
q78luwa8zkk3sqqpqypqzqgyzqxs6rgdp5xs6rgdp5xs6rgdp5xluwa8zkh3yqqsqqqq+
qqqqpapyqqqqqqqqqnztgq
```

As TLV stream bytes:

```
0a0f537570706f7274206d7920776f726b
10f3
03f006a18d5653c4edf5391ff23a61f03ff83d237e880ee61187fa9f379a028e0a
02989c0b76cb563971fdc9bef31ec06c3560f3249d6ee9e5d83c57625596e05f6f
02
0357c734498c1dbe70cfb9b70b5d6fe522ed8e85bd6d0fe39cf8eb3c685d5ff63d
0035
81e1d092c258836667ba83dd2922f805be3ef67ca8a4b535dce48d5cb4ebe9b76283f176edda2fe1c15341e5eadf27fda67516554f
02c1f0ff4b76b93606214484e40a8db806d84add139b00af1bc4be4265abeddfbf
0035
fe8c27d768819443fc6c21bf3fec702a2dbe8e0ac6b6a22e066bd22a6111bf52dd7604821a4941b12c0942595b9af49ed8ab57f169
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
fe3ba715ad18
00010102010104100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
fe3ba715af12
0010
00000000000f4240
00000000004c4b40
```

- `0a 0f ...`: `offer_description`
- `10 f3`: `offer_paths`, 243 bytes
- `03f006...`: the first node id, the introduction node
- `02989c...`: the path key
- `02`: 2 hops, each with its blinded node id, `00 35`, and 53 bytes of
    encrypted data
- `16 21 ...`: `offer_issuer_id`
- `fe3ba715ad 18 ...`: `offer_service`, the label above
- `fe3ba715af 12 ...`: `offer_suggested_amounts`

The same support offer, changed: the same network, `offer_issuer_id`, and
`service_id`, with the description `Support my work and art`, no suggested
amounts, and a `service_sequence` of `1`. A reader MAY know it as the same
support offer. Its `service_sequence` is higher, so a reader MAY replace the
offer above with it, but MUST NOT until its issuer signs something that covers
it, or, while the reader has not kept an authenticated copy of the offer above,
until the reader gets it the same way that it got the offer above, when that way
shows who published it. A reader that keeps this offer MUST NOT replace it with
the offer above, whose `service_sequence` is `0`:

```
lno1pgt4xatswphhyapqd4ujqam0wf4jqctwvssxzun5zres8uqx5xx4v57yah6nj8lj+
8fslq0lc853hazqwucgc075lx7dq9rs2q2vfczmkedtrju0aexl0x8kqds6kpueyn4hw+
newc83tky4vkup0k7qsr2lrngjvvrkl8pnaeku946ml9ytkcapdad587888cav7xsh2l+
7c7sqdvpu8gf9sjcsdnx0w5rm55j97q9hcl0vl9g5j6nth8y34wtf6lfka3g8utkahdz+
lcwp2dq7t6klyl76vagk248s9s0sla9hdwfkqcs5fp8yp2xmspkcftw38xcq4uduf0jz+
vk47mhalqq6larp86a5gr9zrl3kzr0ela3cz5td73c9vdd4z9crxh532vygm75kawczg+
yxjfgxcjcz2zt9de4ay7mz440utfzcssxxuyc4t8kynygzv460k442aq2ewhrcvrgczg+
r8lec9l4a82a6pu0lca6w9ddrvqqzqgzqyqsgyqdp5xs6rgdp5xs6rgdp5xs6rgdqcqs+
z
```

A copy of the changed support offer, of the same generation: its
`service_sequence` is `1`, and its records other than `offer_paths` are
those of the changed support offer, but its offer path is its own, with a
path key made from the secret `09` and a `path_id` of 32 `0b` bytes. A
reader that keeps the changed support offer MAY keep this copy beside it, once
the holder of its `offer_issuer_id` signs something that covers it, or, while
the reader has not kept an authenticated copy of the changed support offer, once
the reader gets it the same way that it got the changed support offer, when that
way shows who published it, and MAY then use either:

```
lno1pgt4xatswphhyapqd4ujqam0wf4jqctwvssxzun5zres8uqx5xx4v57yah6nj8lj+
8fslq0lc853hazqwucgc075lx7dq9rs2qfttx29npj9ltqu7yszcw3u8jsytmvmzg8wf+
ctnuvx065y4jjgykwqszxjvhvkvta6ep2z9fpmu4e3v9v7v9cavz4tnwqc3e9j5r3j8d+
qhusqdt0un2ldvmpkh0mw66nk7hpj0x65cwkknsqrgkdyzzlyw3chhtldmht98cspqqm+
3w4eagex3y2qwut26m7ma4rs83ne6fyzxrujah7kptwr8tq2p6cwujw4x0l49cqhnqkt+
e3c83v2wqq6mk4nm9cu59cn4dadr3xywr6kzj7awy8qsjh284uqtfluhecs5zqq0yg5k+
40q2axdjt8gr6xqwqhvyv8m36w7wzcssxxuyc4t8kynygzv460k442aq2ewhrcvrgczg+
r8lec9l4a82a6pu0lca6w9ddrvqqzqgzqyqsgyqdp5xs6rgdp5xs6rgdp5xs6rgdqcqs+
z
```

A support offer with the same `offer_issuer_id` and `service_id` on
testnet3.
A reader MUST NOT treat it as the same support offer as the one above,
since its network is not the same:

```
lno1qgsyxjtl6luzd9t3pr62xr7eemp6awnejusgf6gw45q75vcfqqqqqqq2pafh2urs+
dae8ggrd0ys8wmmjdvg0xqlsq6sc64jncnkl2wgl7gaxrupllq7jxl5gpmnprpl6nume+
5q5wpgpf38qtwm94vwt3lhymauc7cpkr2c8nyjwka609mq79wcj4jms97mczqdtuwdzf+
3swmuux0hxmskht0u53wmr59h4kslcuulr4nc6zatlmr6qp4s8sapykztzpkvea6s0wj+
jghcqklraanu4zjt2dwuujx4ed8taxmk9ql3wmka5tlpc9f5re02munlmfn4ze257qkp+
7rl5ka4excrzz3yyus9gmwqxmp9d6yumqzh3h397gfj6hmwlhuqrtl5vyltk3qv5g07x+
cgdl8lk8q23dh68q434k5ghqv67j9fs3r06jm4mqfqs6f9qmztqfgfv4hxh5nmv2k4l3+
dytzzqcmsnz4v7cjv3qfjhf76k4t5pt96u0psdrqfqvll8qh7h5athg83llrhfc445vq+
qqgpqgqszpqsp5xs6rgdp5xs6rgdp5xs6rgdp5
```

A reader MUST treat this offer as a normal offer and not a support offer,
since its label has no `service_id`:

```
lno1pg84xatswphhyapqd4ujqam0wf43pucr7qr2rr2k20zwmaferler5c0s8lur6gm7+
3q8wvyv8l20n0xsz3c9q9xyupdmvk43ew87un0hnrmqxcdtq7vjf6mhfuhvrc4mz2ktw+
qhm0qgp403e5fxxpm0nse7umwz6adljj9mvwsk7k6rlrnnuwk0rgt40lv0gqxkq7r5yj+
cfvgxen8h2pa62fzlqzmu0hk0j52fdf4mnjg6h95a05mwc5r79mwmk30u8q4xs09at0j+
0ldxw5t92nczc8c07jmkhymqvg2ysnjq4rdcqmvy4hgnnvq27x7yhepxt2ldm7lsqd07+
3snaw6ypj3plcmpphul7cup29klguzkxk63zupnt6g4xzydl2twhvpyzrfy5rvfvp9p9+
jku67j0d326h7953vggrrwzv24nmzfjypx2a8m264ws9vht3uxp5vpypnluuzl67n4wa+
q78luwa8zkksvqqpqypqzqg
```

A reader MUST treat this offer as a normal offer and not a support offer,
since its `offer_chains` has the chain hashes of two networks, testnet3
and signet:

```
lno1qfqyxjtl6luzd9t3pr62xr7eemp6awnejusgf6gw45q75vcfqqqqqq8krmhrkcar+
szj80grr4uet9w7f0j0lnuql93pzt6tnnzqssqqqqq9q75m4wpcx7un5ypkhjgrhdaex+
ky8nq0cqdgvd2efufm048y0lywnp7qlls0fr06yqaes3slaf7du6q28q5q5cns9hdj6k+
89clmjd77v0vqmp4vrejf8twa8jas0zhvf2edczldupqx478x3ycc8d7wr8mndctt4h7+
2ghd36zm6mg0uww036eudpw4la3aqq6crcwsjtp93qmxv7ag8hffytuqt0377e723f94+
xhwwfr2ukn47ndmzs0chdmw69lsuz56puh4d7fla5e63v420qtqlpl6tw6unvp3pgjzw+
gz5dhqrdsjkazwdsptcmcjlyyedtah0m7qp4l6xz04mgsx2y8lrvyxlnlmrs9gkmars2+
c6m2ytsxd0fz5cg3hafd6asysgdyjsd39sy5yk2mnt6fak9t2lckj93pqvdcf32k0vfx+
gsyet5ldt246q4jaw8scx3sysx0lnstlt6w4m5rcll3m5u266xqqqyqsyqgpqsgq6rgd+
p5xs6rgdp5xs6rgdp5xs6
```

A reader MUST treat this offer as a normal offer and not a support offer,
since its `offer_chains` has the chain hash of regtest and a chain hash of
32 `01` bytes, which is not of a Bitcoin network. A reader that leaves out
chains that it does not know would see only regtest:

```
lno1qfqqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrcpqyqszqgp+
qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqy9q75m4wpcx7un5ypkhjgrhdaex+
ky8nq0cqdgvd2efufm048y0lywnp7qlls0fr06yqaes3slaf7du6q28q5q5cns9hdj6k+
89clmjd77v0vqmp4vrejf8twa8jas0zhvf2edczldupqx478x3ycc8d7wr8mndctt4h7+
2ghd36zm6mg0uww036eudpw4la3aqq6crcwsjtp93qmxv7ag8hffytuqt0377e723f94+
xhwwfr2ukn47ndmzs0chdmw69lsuz56puh4d7fla5e63v420qtqlpl6tw6unvp3pgjzw+
gz5dhqrdsjkazwdsptcmcjlyyedtah0m7qp4l6xz04mgsx2y8lrvyxlnlmrs9gkmars2+
c6m2ytsxd0fz5cg3hafd6asysgdyjsd39sy5yk2mnt6fak9t2lckj93pqvdcf32k0vfx+
gsyet5ldt246q4jaw8scx3sysx0lnstlt6w4m5rcll3m5u266xqqqyqsyqgpqsgq6rgd+
p5xs6rgdp5xs6rgdp5xs6
```

### Offer References

A menu entry that is a reference to the support offer above at the name
`show@example.com`, with its `service_id` and a `service_sequence` of `1`:

```
02110473686f770b6578616d706c652e636f6d
0421031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
06100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
0a0101
```

- `02 11 ...`: `name`, 17 bytes, `show` and `example.com`, each after its length
- `04 21 ...`: `issuer_id`, 33 bytes, the key of the secret `01`
- `06 10 ...`: `service_id`, 16 bytes
- `0a 01 01`: `service_sequence`, `1`

A reader that finds the support offer above at the name MUST NOT use it for
this reference, since its `service_sequence` is `0`, which is lower. A
reader that finds the changed support offer above, whose `service_sequence`
is `1`, can use it.

A reader MUST NOT use this reference, which has a `service_sequence` without
a `service_id`:

```
02110473686f770b6578616d706c652e636f6d
0421031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
0a0101
```

A reader MUST NOT use this reference, whose `service_sequence` is not a
minimal `tu64`:

```
02110473686f770b6578616d706c652e636f6d
0421031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
06100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
0a020001
```

### Menu Request

A signed menu request for the first page of the menu of the offer above,
with an `invreq_metadata` of 32 zero bytes, signed with 32 zero bytes of
auxiliary data. A recipient MUST read it as a menu request for the first
page when it arrives on the offer path. A payer uses a new
`invreq_payer_id` and `invreq_metadata` for each menu request, so it never
sends these exact bytes.

```
00200000000000000000000000000000000000000000000000000000000000000000
0a0f537570706f7274206d7920776f726b
10f3
03f006a18d5653c4edf5391ff23a61f03ff83d237e880ee61187fa9f379a028e0a
02989c0b76cb563971fdc9bef31ec06c3560f3249d6ee9e5d83c57625596e05f6f
02
0357c734498c1dbe70cfb9b70b5d6fe522ed8e85bd6d0fe39cf8eb3c685d5ff63d
0035
81e1d092c258836667ba83dd2922f805be3ef67ca8a4b535dce48d5cb4ebe9b76283f176edda2fe1c15341e5eadf27fda67516554f
02c1f0ff4b76b93606214484e40a8db806d84add139b00af1bc4be4265abeddfbf
0035
fe8c27d768819443fc6c21bf3fec702a2dbe8e0ac6b6a22e066bd22a6111bf52dd7604821a4941b12c0942595b9af49ed8ab57f169
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
520203e8
582103462779ad4aad39514614751a71085f2f10e1c7a593e4e030efb5b8721ce55b0b
f040
204c638fac882146b7bdef5b33358684bcf6984844e5ed24bf4b379432b584f2360ca8eedecaa9ef11aede70bcdd7bff8e27e8d44496ab8b0dbb9877c7b96bfb
fe3ba715ad18
00010102010104100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
fe3ba715af12
0010
00000000000f4240
00000000004c4b40
fe7741dfad00
```

- `00 20 ...`: `invreq_metadata`
- `0a`, `10`, and `16`: the offer records
- `52 02 03e8`: `invreq_amount` of 1000
- `58 21 ...`: `invreq_payer_id`
- `f0 40 ...`: `signature`
- `fe3ba715ad 18 ...` and `fe3ba715af 12 ...`: `offer_service` and
    `offer_suggested_amounts`, copied from the offer
- `fe7741dfad 00`: `invreq_support_menu`, type `2000805805`, with no options

A menu request for the second page has this record:

```
fe7741dfad03
000101
```

- `00 01 01`: `page` `1`

A menu request with an unknown odd option, type `3`, has this record. The
recipient MUST ignore the option and reply with the first page:

```
fe7741dfad03
030100
```

A menu request with an unknown even option, type `2`, has this record:

```
fe7741dfad02
0200
```

The recipient MUST NOT reply with a page, and SHOULD reply with an invoice
error like this one:

```
01047741dfad
051d556e737570706f72746564537570706f72744d656e7552657175657374
```

- `01 04 7741dfad`: `erroneous_field`, `2000805805`
- `05 1d ...`: `error`, `UnsupportedSupportMenuRequest`

### Menu Pages

The pages below are signed with the key of the support offer issuer, the
secret `01`, with 32 zero bytes of auxiliary data. Signatures change with
their auxiliary data, so a writer does not need to make these exact bytes.
Unless a page says otherwise, its signature is valid.

The `menu_id` of each page here is the first 16 bytes of the SHA256 of the
list of the pages of its menu, where each page is the list of its entries,
as they are encoded. For pages that have no records other than `entries`,
`page`, `pages`, `absolute_expiry`, `menu_id`, and `signature`, that is one
way to follow the rules for `menu_id`, and a writer can use another, like
random bytes. Some pages below add other records to show how they are read,
and keep the `menu_id` of the same page without them. Each page here is an
example on its own, and a writer that made these pages together would give
each of them a `menu_id` of its own.

A page that lists two entries, with an `absolute_expiry` of the start of
2100:

- `Support this episode`, an offer from the same issuer as the support offer,
    with a suggested amount of 2,100,000 millisatoshis, listed without its paths
- `Support the guest`, an offer from another issuer, listed as a reference to
    the name `guest@example.com`

The episode offer has its own path to the same recipient as the support
offer, through the same introduction node, with a path key made from the
secret `08` and a `path_id` of 32 `0c` bytes. Before it is encrypted, the
data for each hop is:

```
010004210362c0a046dacce86ddd0343c6d3c7c79c2208ba0d9c9cf24a6d046d21d21f90f7
01010006200c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c
```

The episode offer, split with `+`:

```
lno1pg29xatswphhyapqw35xjueqv4cxjum0v3j3pucr7qr2rr2k20zwmaferler5c0s+
8lur6gm73q8wvyv8l20n0xsz3c9q87v3l9zdrcv4fflu3wdlvtsd0rcptaxqwa3d2p0z+
peky2fs2xesmqgp3zygdk97l68sxjrf9tms43lqdhsjy7wutu7m2yevkekev4kphw5gq+
x5mracmnufrf58g3593hzhf6jzzl5jxrl93az8mpe6y9t9mvt808vurf6d0wg8sgtdt6+
f33aevf6he0khtu2n7qr60eqrjwhhaw5w5dl8wp5phzrxmk40thdzu9tc6z82ekxpgvt+
za9sqd22dc8l62u2nuajyc677fttnk74nzl0vvlcdlspafyx0jn9xr2nqrl0hwp4hc0h+
maxemh9swyue07uy5gp79c7pvggrrwzv24nmzfjypx2a8m264ws9vht3uxp5vpypnluu+
zl67n4waq78luwa8zkhs5qqgqqqqqqqqyq9jq
```

Listed without its paths, the offer of the entry is the episode offer with
the paths of the support offer instead of its own:

```
lno1pg29xatswphhyapqw35xjueqv4cxjum0v3j3pucr7qr2rr2k20zwmaferler5c0s+
8lur6gm73q8wvyv8l20n0xsz3c9q9xyupdmvk43ew87un0hnrmqxcdtq7vjf6mhfuhvr+
c4mz2ktwqhm0qgp403e5fxxpm0nse7umwz6adljj9mvwsk7k6rlrnnuwk0rgt40lv0gq+
xkq7r5yjcfvgxen8h2pa62fzlqzmu0hk0j52fdf4mnjg6h95a05mwc5r79mwmk30u8q4+
xs09at0j0ldxw5t92nczc8c07jmkhymqvg2ysnjq4rdcqmvy4hgnnvq27x7yhepxt2ld+
m7lsqd073snaw6ypj3plcmpphul7cup29klguzkxk63zupnt6g4xzydl2twhvpyzrfy5+
rvfvp9p9jku67j0d326h7953vggrrwzv24nmzfjypx2a8m264ws9vht3uxp5vpypnluu+
zl67n4waq78luwa8zkhs5qqgqqqqqqqqyq9jq
```

The guest offer has no path, so that the vectors are shorter. An offer like
that can only be paid when its `offer_issuer_id` is a node that can be
reached. It can be found at the name `guest@example.com`:

```
lno1pgg4xatswphhyapqw35x2gr8w4jhxaqkyypy6jmv6ympqvk2n0f2awweqz4y63weatvq4j2zxd6vg5d8y4xswes
```

The chain hash of bitcoin, the `offer_issuer_id`, and the `service_id` of the
support offer, as they are signed with the page, then the `menu_hash` and
the signature of the page:

```
6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000
031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
925665cfee7569129f1cbc1b54efb4921cece96dfeb54ebc8223c69d36c4d390
c75f5a592266c36e106531324a651ee4da75558be0f32f620326d0707f69904d96ca69504d2d56e927cc462e99d370f8d43d3a60184586912bfeeefa62c426eb
```

A reader shows the first entry as paying the recipient of the support
offer, and the second entry, once it finds the guest offer at the name, as
found through a reference that the recipient listed, and as paying someone
else:

```
050b537570706f72744d656e75
fe000c4bade0
0084
4b
0849
0a14537570706f7274207468697320657069736f6465
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
fe3ba715af0a
0008
0000000000200b20
37
02120567756573740b6578616d706c652e636f6d
0421024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0604f4865700
0810d59482da90fcdce7def596351accc043
f040
c75f5a592266c36e106531324a651ee4da75558be0f32f620326d0707f69904d96ca69504d2d56e927cc462e99d370f8d43d3a60184586912bfeeefa62c426eb
```

- `05 0b ...`: `error`, `SupportMenu`
- `fe000c4bad e0`: `support_menu`, type `805805`, 224 bytes
- `00 84`: `entries`, 132 bytes
- `4b`: the first entry, 75 bytes
- `08 49`: `offer_without_paths`, 73 bytes
- `37`: the second entry, 55 bytes
- `02 12 ...`: `name`, 18 bytes, `guest` and `example.com`, each after its
    length
- `04 21 ...`: `issuer_id`, 33 bytes
- `06 04 f4865700`: `absolute_expiry`, the start of 2100
- `08 10 d59482da90fcdce7def596351accc043`: `menu_id`
- `f0 40 ...`: `signature`

A menu of two pages, with the episode offer on the first page and the guest
offer on the second, has the `menu_id`
`053940518563cb371f4848137eb10856`. The first page:

```
050b537570706f72744d656e75
fe000c4badfd01a6
00fd0145
fd0142
00fd013e
0a14537570706f7274207468697320657069736f6465
10f3
03f006a18d5653c4edf5391ff23a61f03ff83d237e880ee61187fa9f379a028e0a
03f991f944d1e1954a7fc8b9bf62e0d78f015f4c07762d505e20e6c45260a3661b
02
0311110db17dfd1e0690d255ee158fc0dbc244f3b8be7b6a26596cdb2cad837751
0035
363ee373e2469a1d11a163715d3a9085fa48c3f963d11f61ce8855976c59de767069d35ee41e085b57a4c63dcb13abe5f6baf8a9f8
03d3f201c9d7bf5d4751bf3b8340dc4336ed57aeed170abc6847566c60a18b174b
0035
4a6e0ffd2b8a9f3b22635ef256b9dbd598bef633f86fe01ea4867ca6530d5300fefbb835be1f7df4d9ddcb0713997fb84a203e2e3c
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
fe3ba715af0a
0008
0000000000200b20
040102
0604f4865700
0810053940518563cb371f4848137eb10856
f040
d9dfd3da50b7eb13b18098d6235e0eaf8481ae151dbf8295e280bc8105febaacfb2e7c178f6df438af831fccb302f7c8fe9fb9a16f8c82ff440f4794578b16e2
```

- `04 01 02`: `pages` `2`

The second page:

```
050b537570706f72744d656e75
fe000c4bad9b
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
020101
040102
0604f4865700
0810053940518563cb371f4848137eb10856
f040
b00d2f764fb696a2d1369a37c028057faa78e37df686c4872c233889b07c412c3b73122d8df40bb952fc98946173da82547262477ed5781baccce1ed7cc877b4
```

- `02 01 01`: `page` `1`
- `04 01 02`: `pages` `2`

The second page of another menu of two pages, with the guest offer on the
first page and the episode offer on the second, and the `menu_id`
`8909717c29700432cce163a2a0b61449`. A reader that has the first page above
MUST NOT use this page with it, since their `menu_id` values are not the
same. Used together, they would list the episode offer twice and the guest
offer not at all:

```
050b537570706f72744d656e75
fe000c4badfd01a9
00fd0145
fd0142
00fd013e
0a14537570706f7274207468697320657069736f6465
10f3
03f006a18d5653c4edf5391ff23a61f03ff83d237e880ee61187fa9f379a028e0a
03f991f944d1e1954a7fc8b9bf62e0d78f015f4c07762d505e20e6c45260a3661b
02
0311110db17dfd1e0690d255ee158fc0dbc244f3b8be7b6a26596cdb2cad837751
0035
363ee373e2469a1d11a163715d3a9085fa48c3f963d11f61ce8855976c59de767069d35ee41e085b57a4c63dcb13abe5f6baf8a9f8
03d3f201c9d7bf5d4751bf3b8340dc4336ed57aeed170abc6847566c60a18b174b
0035
4a6e0ffd2b8a9f3b22635ef256b9dbd598bef633f86fe01ea4867ca6530d5300fefbb835be1f7df4d9ddcb0713997fb84a203e2e3c
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
fe3ba715af0a
0008
0000000000200b20
020101
040102
0604f4865700
08108909717c29700432cce163a2a0b61449
f040
963bc52a57d2c9f274dbbf6266ff87aaab94d5426d83cf2f7e3fab25cb26e956b90cba2e1e5566ec40c71913a0595d94cb26f288e5affefa6d602e1774009682
```

A page with no entries. A reader MUST treat it as a menu with no offers:

```
050b537570706f72744d656e75
fe000c4bad5a
0604f4865700
08106e340b9cffb37a989ca544e6bb780a2c
f040
4c768a127f2d82be9f23b193c09395fb28eb77a4a5dbfcc172a093e6ea5128cb6040753745bfd9538431c8f4773e2d736fc8b5cb79b7176cc1301c60bf8e0952
```

A page with an unknown odd record, type `7`. A reader MUST ignore the
unknown record, and reads the guest offer. The signature covers the unknown
record, so a reader that leaves it out before it checks the signature finds
the signature not valid:

```
050b537570706f72744d656e75
fe000c4bad98
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0604f4865700
070100
08104b2dedc7a212fed9b54164cd12fc6c05
f040
7a1e3d03a9b0834645a9d62db6d36613860f66e169b14143a3b6b2cb2533cfca3fb9fe75d9ad0ecc48efc3f0ccd416c658e416837b9604a029d01b5f3fcfd687
```

A page with an unknown odd record, type `241`, after its signature. The
signature covers it too. A reader MUST ignore the unknown record, and reads
the guest offer:

```
050b537570706f72744d656e75
fe000c4bad98
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0604f4865700
08104b2dedc7a212fed9b54164cd12fc6c05
f040
eda9d9707b750d75607b580999e78e75e66698f0cd032f2e559338751197580bce6c6f6577c8877d536b2167bb8400989007b2535ef8b14db574c490b4ec2b2d
f10100
```

A page whose `support_menu` value is exactly 768 bytes, made longer by an
unknown odd record of type `7`. A reader MUST read it, and reads the guest
offer:

```
050b537570706f72744d656e75
fe000c4badfd0300
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0604f4865700
07fd0267
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000000000000000000000000000000000
08104b2dedc7a212fed9b54164cd12fc6c05
f040
9b0592efb6d86066a5e515337574b9b3959f80d600c4ab4df4eec4501deb85b11831347c33d577978d385e0146fdd9864eb8e0c1232fdbadeb2eb596a49d863f
```

A page with one entry that has an unknown odd record, type `3`. A reader
MUST ignore the unknown record, and reads the guest offer:

```
050b537570706f72744d656e75
fe000c4bad98
003c
3b
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
030100
0604f4865700
08102857f39b3fa05fd54d769a6085268ad5
f040
c2c3f1239d73a64564cade5e854483aea8162a5be0104e6de1a11b5341f1b78a2c88c4cfa6a8575f6e475f232dc1c799c4ab7d51d33ecc9c1f0e0a27082cb7b4
```

A page with one entry that has an unknown even record, type `12`. A reader
MUST leave the entry out, and reads a page with no offers:

```
050b537570706f72744d656e75
fe000c4bad98
003c
3b
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0c0100
0604f4865700
0810b0439d1b753a99df35a9ff9c6d839374
f040
6945fbae4e03ee641cd7730bc3201b30c0be68eac60bcba1bb17b2e1eca8faa3fca83003f12f8afad2a048ff3b7e2e5051d616b7d88fcf23437ca0b7629876e2
```

A page with entries that a reader MUST leave out, so that it reads a page
with no offers:

- The guest offer as `offer_without_paths`, which does not have the
    `offer_issuer_id` of the support offer
- The episode offer with its `offer_paths`, as `offer_without_paths`
- The guest offer as `offer` with a `name`, which is two forms
- A reference with an `issuer_id` that is not a valid point

```
050b537570706f72744d656e75
fe000c4badfd0261
00fd0203
38
0836
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
fd0142
08fd013e
0a14537570706f7274207468697320657069736f6465
10f3
03f006a18d5653c4edf5391ff23a61f03ff83d237e880ee61187fa9f379a028e0a
03f991f944d1e1954a7fc8b9bf62e0d78f015f4c07762d505e20e6c45260a3661b
02
0311110db17dfd1e0690d255ee158fc0dbc244f3b8be7b6a26596cdb2cad837751
0035
363ee373e2469a1d11a163715d3a9085fa48c3f963d11f61ce8855976c59de767069d35ee41e085b57a4c63dcb13abe5f6baf8a9f8
03d3f201c9d7bf5d4751bf3b8340dc4336ed57aeed170abc6847566c60a18b174b
0035
4a6e0ffd2b8a9f3b22635ef256b9dbd598bef633f86fe01ea4867ca6530d5300fefbb835be1f7df4d9ddcb0713997fb84a203e2e3c
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
fe3ba715af0a
0008
0000000000200b20
4c
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
02120567756573740b6578616d706c652e636f6d
37
02120567756573740b6578616d706c652e636f6d
0421020000000000000000000000000000000000000000000000000000000000000000
0604f4865700
08106f55974cce6d51bd675073a597b5e0c4
f040
3b33cc07a763ed3f2529bd67dced1ff616dfcb552f476194b9ea081ea63aabaa87d98e7612f8f97689d6ee9ebd6422e9a149711f74d25da9893f595db3449f50
```

A page with an entry for an offer that expired at the start of 2025, and an
entry for an offer on testnet3. A reader paying on bitcoin MUST leave both
entries out. The offers are:

```
lno1pgg4xatswphhyapqd3shxapq09jkzuswq3nhfpvqzcssxxuyc4t8kynygzv460k442aq2ewhrcvrgczgr8lec9l4a82a6pu0
lno1qgsyxjtl6luzd9t3pr62xr7eemp6awnejusgf6gw45q75vcfqqqqqqq2zffh2ursdae8ggr0dcs8getnw3hx2aqkyyp3hpx92ea3yezqn9wna4d2hgzkt4c7rq6xqjqel7wp0a0f6hws0rc
```

The page:

```
050b537570706f72744d656e75
fe000c4badf7
009b
3e
003c
0a11537570706f7274206c6173742079656172
0e0467748580
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
5b
0059
022043497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000
0a12537570706f7274206f6e20746573746e6574
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
0604f4865700
0810bf16aef3623a08af43cd4f8af04ee2b5
f040
93b76cde0cb9709f2941fa1763b6821e00d4671b9325e3a0575fa46389ff0b039362010401b353fab3cc3bebc35c056eba4751ee3059608da5e4d5259998966e
```

A page with an entry for an offer on both bitcoin and testnet3. A reader
paying on bitcoin MUST read the entry, since the offer can be paid on
bitcoin. The offer is:

```
lno1qfqxlc5vp2m0rvmjcxn2y34wv0m5lyc7sdj7zksgn35dvxgqqqqqqqzrf9la07pxj4cs3a9rplvuasawhfuewgyyay826q02xvysqqqqqq9p65m4wpcx7un5yphkugrzd96xxmmfdcsx7u3qw3jhxarwv46pvggrrwzv24nmzfjypx2a8m264ws9vht3uxp5vpypnluuzl67n4waq78s
```

The page:

```
050b537570706f72744d656e75
fe000c4bade3
0087
86
0084
02406fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d619000000000043497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000
0a1d537570706f7274206f6e20626974636f696e206f7220746573746e6574
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
0604f4865700
0810412a6d0cd3bda90f8b9db665e4f947e0
f040
15e19f1d4107847fc2451b4bade4a4517ab6cba28555c7bdfd8b59c6f5545c031b43e5f2333020bdb3be48c1306d6a8d57a09714ee3646c19b991af0f628c761
```

A page with one entry for an offer with a label of the service type `2`,
which a reader of this version does not know. A reader MUST treat the entry
as a normal offer. The offer is:

```
lno1pgx55mmfdcs8g6r9yp3kcatzzcssxxuyc4t8kynygzv460k442aq2ewhrcvrgczgr8lec9l4a82a6pu0lca6w9ddqcqqzqszqyqs
```

The page:

```
050b537570706f72744d656e75
fe000c4bad9d
0041
40
003e
0a0d4a6f696e2074686520636c7562
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
fe3ba715ad06
000102020101
0604f4865700
08100adcb865272f535ba1c467fb750df569
f040
0d59ccc35e3f2f8ede26aa574f971ec0867279b20eb76e854495124ec12b866529cd72bd8d2f9f877a391ca156c66f932b4890825cf79b53bbb0ebb993ef3fc0
```

The pages below MUST NOT be used.

A page without a signature:

```
050b537570706f72744d656e75
fe000c4bad53
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0604f4865700
08104b2dedc7a212fed9b54164cd12fc6c05
```

A page whose signature has its first byte changed:

```
050b537570706f72744d656e75
fe000c4bad95
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0604f4865700
08104b2dedc7a212fed9b54164cd12fc6c05
f040
a5b99800349a86c6646f6e008211f86da50377d92064c6f5402c3e85fd1024195f2e4e9faffae43347be705501887ab517c32d8db3a400d62cd67f52f0eb0408
```

A page with an `absolute_expiry` of the start of 2025, which has passed:

```
050b537570706f72744d656e75
fe000c4bad95
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
060467748580
08104b2dedc7a212fed9b54164cd12fc6c05
f040
ce79a513bac7293a1e0029e6d8c52627d032ea2120183bbdffd26a9ec9a726b808d860da11738f12a11d38f400d5b36a57d6a17e648576d5d890c8969a1c668c
```

A page without `absolute_expiry`, with a valid signature:

```
050b537570706f72744d656e75
fe000c4bad8f
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
08104b2dedc7a212fed9b54164cd12fc6c05
f040
d57fbfb6aa1bb36c119aabb210dd34040e74bef325c65c5e7af0155eaa78e58caf2bef7ad1c27d2ccb7f9dead1e62dee635dd3b26f56f2d96cb3c421e5d14129
```

A page without `menu_id`, with a valid signature:

```
050b537570706f72744d656e75
fe000c4bad83
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0604f4865700
f040
65fbe89473819ba9b9592b3ddaa46890b1b0363eba63df932fb181627f90ea466db46a1b4ba6b3db89abc784d8c35594629d2857cf8cf1d32e91a9be510bbb8a
```

A page with a `menu_id` of 15 bytes, with a valid signature:

```
050b537570706f72744d656e75
fe000c4bad94
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0604f4865700
080f2dedc7a212fed9b54164cd12fc6c05
f040
d1988f3616992c794923581edf2be242e65a684c5f627bef2bc1bf8d0d859c45615fb151bb5b4ae8c159a443519b52acd1eddfe069d57a9da327fa1e1c98892b
```

A page with its `menu_id` before its `absolute_expiry`, so that its records
are not in order, with a valid signature of its bytes as they are. A reader
that accepts records that are not in order would find its signature valid:

```
050b537570706f72744d656e75
fe000c4bad95
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
08104b2dedc7a212fed9b54164cd12fc6c05
0604f4865700
f040
99106f677e7b25f5fc942df2013be2af840190d99d1d1b15910cafed86fe2977246f39e64b2d53bad76b1762cd482abeab161c5ad72f6b1d094ee308bf3e707e
```

A page whose `support_menu` value is 769 bytes, with a valid signature:

```
050b537570706f72744d656e75
fe000c4badfd0301
0039
38
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0604f4865700
07fd0268
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000
08104b2dedc7a212fed9b54164cd12fc6c05
f040
de548c68b1c0f3e63be33c3bcf9bd1c58d06b715954aeedc2cd56a88b7372f5536851b9121005aa8c5f6a5431c0abc7f7243ae46e7b0f73bb4573a521472c996
```

A page with an unknown even record, type `10`:

```
050b537570706f72744d656e75
fe000c4bad5d
0604f4865700
08106e340b9cffb37a989ca544e6bb780a2c
0a0100
f040
3c53a489e3db7a012df1cb3f200bfa1bdd0afc9c2af20cdd30a5ed0ffaf10f6fbdfa3d957d0cfedde927baa9e5a4f5abf3d294897d025ddc68cf943c8a4f02de
```

A page with `entries` that are not a valid list, since the first entry is
said to be 5 bytes but only 2 follow:

```
050b537570706f72744d656e75
fe000c4bad5f
0003050000
0604f4865700
08106e340b9cffb37a989ca544e6bb780a2c
f040
3c4fc6daea5651cb15aac27da99223a7d60b1db83f5bc151c77cda60486c317dcd1ba463c82826355e28ab071948ab3297b6b01c8314a81a36d38318f2a8fab5
```

A page with a `page` of `1` and no `pages`, so it is not below `pages`:

```
050b537570706f72744d656e75
fe000c4bad5d
020101
0604f4865700
08106e340b9cffb37a989ca544e6bb780a2c
f040
acd36eaa8a4ace47ae722056c490af3b164d5b840306fe8c8498700eb54a78f3b43d363b186f2ce9c0bb6ff0e2331f0a1eda768abcf55b6701506a34fe3018d2
```

### Payer Offer

The guest offer above, sent as a payer offer by a payer with an
`invreq_payer_id` of the key of the secret `04`. It is signed with the secret
`02`, the key of its `offer_issuer_id`, with 32 zero bytes of auxiliary data.
The `chain_hash` that is signed is that of bitcoin, the network of the support
offer that the request pays, and the `payer_offer` that is signed is the record
below without its `signature`. The `payer_offer_hash` and the signature are:

```
3e5f8e81a9e24416c7199fbdb5c2492f16c42003f59ef943ab237c2316705a42
2f5026ef93efead6d492f2d60cd663c0010c21cdeb6f790c7cf41237cf37efb196d83a6b8a347dc53f09aaff8ec75d1765c5fe69084e81ce2907fec2666e3f79
```

The `invreq_payer_offer` record:

```
fe7741dfaf7a
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
f040
2f5026ef93efead6d492f2d60cd663c0010c21cdeb6f790c7cf41237cf37efb196d83a6b8a347dc53f09aaff8ec75d1765c5fe69084e81ce2907fec2666e3f79
```

- `fe7741dfaf 7a`: `invreq_payer_offer`, type `2000805807`, 122 bytes
- `00 36`: `offer`, 54 bytes, the guest offer
- `f0 40`: `signature`

A request to pay the support offer 5,000,000 millisatoshis, with an
`invreq_metadata` of 32 zero bytes and the payer offer, signed with 32 zero
bytes of auxiliary data. A recipient MUST read the guest offer as the
payer offer of the request. A payer uses its own transient
`invreq_payer_id`, as BOLT 12 asks, and its payer offer is signed for that
key, so it does not send these exact bytes:

```
00200000000000000000000000000000000000000000000000000000000000000000
0a0f537570706f7274206d7920776f726b
10f3
03f006a18d5653c4edf5391ff23a61f03ff83d237e880ee61187fa9f379a028e0a
02989c0b76cb563971fdc9bef31ec06c3560f3249d6ee9e5d83c57625596e05f6f
02
0357c734498c1dbe70cfb9b70b5d6fe522ed8e85bd6d0fe39cf8eb3c685d5ff63d
0035
81e1d092c258836667ba83dd2922f805be3ef67ca8a4b535dce48d5cb4ebe9b76283f176edda2fe1c15341e5eadf27fda67516554f
02c1f0ff4b76b93606214484e40a8db806d84add139b00af1bc4be4265abeddfbf
0035
fe8c27d768819443fc6c21bf3fec702a2dbe8e0ac6b6a22e066bd22a6111bf52dd7604821a4941b12c0942595b9af49ed8ab57f169
1621031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f
52034c4b40
582103462779ad4aad39514614751a71085f2f10e1c7a593e4e030efb5b8721ce55b0b
f040
054986daa2b85c45444022e2269d799964d761607c8d60887aad35a04e10494f7acd60b50b720382b12512539dd8a8f48551314a1abcdd85740441f4bfdfe0e9
fe3ba715ad18
00010102010104100d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
fe3ba715af12
0010
00000000000f4240
00000000004c4b40
fe7741dfaf7a
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
f040
2f5026ef93efead6d492f2d60cd663c0010c21cdeb6f790c7cf41237cf37efb196d83a6b8a347dc53f09aaff8ec75d1765c5fe69084e81ce2907fec2666e3f79
```

A recipient MUST read the guest offer as the payer offer of a request
with this record, which has an unknown odd record, type `1`, that is signed:

```
fe7741dfaf7d
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
010100
f040
65ee5d3d90b4fc2156b4a5d7b31271ea081b9ebd2c2ac03db6e91906cfb8e3f86b10ed9ddf8df428c67f13ff9462bde10e441cfec005613741594768775d44b2
```

A recipient MUST read the guest offer as the payer offer of a request with
this record, which has a signed `expiry` of the start of 2100, until the
start of 2100:

```
fe7741dfaf80
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0804f4865700
f040
f533b840a38fbeca84abbb68d680438ec51ae90a672a7231162ef9cc1d769215d44253680d415ece3bd0f88fe84909c53adb7782dc55eaebaa775689af235dd6
```

- `08 04 f4865700`: `expiry`, the start of 2100

A reference to the guest offer at the name `guest@example.com`, signed for
the same payer with the secret `02`. A recipient MUST read it as a
reference, and MAY look up the guest offer at the name. An offer found there
can be used when its `offer_issuer_id` is the `issuer_id` of the reference:

```
fe7741dfaf79
02120567756573740b6578616d706c652e636f6d
0421024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
f040
b679f33a91068fff0b64bc2eb734142df5c524d90f1e4a6bc5dc49ffcb57002a88f459b26aea9b07473a594c802b69e7efb64116bed045f40bc8df47fdecf4b9
```

- `fe7741dfaf 79`: `invreq_payer_offer`, type `2000805807`, 121 bytes
- `02 12 ...`: `name`, 18 bytes, `guest` and `example.com`, each after its
    length
- `04 21 ...`: `issuer_id`, 33 bytes
- `f0 40 ...`: `signature`

A recipient MUST ignore each of the `invreq_payer_offer` records below, and
MUST still treat a request with one as a request to pay.

A payer offer with both an `offer` and a reference, signed:

```
fe7741dfafb1
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
02120567756573740b6578616d706c652e636f6d
0421024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
f040
4c1d72ca4268307ea3f8d2c79ba64268edb4dfe09006a93c73cd1242c3c5782be2b6be535e1a48d33cb16c252b9770f7d93cd2d5840c5edf183089bed4cd4a27
```

A payer offer with an `offer` and a `name`, signed:

```
fe7741dfaf8e
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
02120567756573740b6578616d706c652e636f6d
f040
9dbe590ec2e3ad7a872ce3617cef371195799da6af357f712bbd448c343b9c673c7849f73cede28f5ce00b5c8ef82b8bb3febf55c200377ec4dbfed15e68f98d
```

A payer offer signed for the `invreq_payer_id` of the key of the secret
`05`:

```
fe7741dfaf7a
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
f040
65fde031050df0da1dd52c9db04b81921c891cc30aaaedcde94dfdfd3b74a420f5749655368b56ed89d34d7589a65ce06ef7c47708ec7f382cf7d300d5c9199c
```

The reference to the guest offer above, signed for testnet instead of
bitcoin, the network of the support offer that the request pays:

```
fe7741dfaf79
02120567756573740b6578616d706c652e636f6d
0421024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
f040
64372cbe53dd7536a73fe7b6aaecfbfc0c47745ee9f28651db973b18285005e2cfadbbdd4edb17d69b4107788c390dc46be103e42f0cc425c8fa8681a2111adf
```

A payer offer for an offer that expired at the start of 2025, signed:

```
fe7741dfaf80
003c
0a11537570706f727420746865206775657374
0e0467748580
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
f040
41b2f6943a312b0c25a79e3c9277400a8e86fd7cf166e6c97ab143e9e09c8529fb19cfa828e404c5ff49d2e7abfba5ebe972e67b9904a13967ce84691c512329
```

A payer offer for an offer without an `offer_issuer_id`:

```
fe7741dfaffd014c
00fd0106
0a0f537570706f7274206d65206261636b
10f3
03f006a18d5653c4edf5391ff23a61f03ff83d237e880ee61187fa9f379a028e0a
02989c0b76cb563971fdc9bef31ec06c3560f3249d6ee9e5d83c57625596e05f6f
02
0357c734498c1dbe70cfb9b70b5d6fe522ed8e85bd6d0fe39cf8eb3c685d5ff63d
0035
81e1d092c258836667ba83dd2922f805be3ef67ca8a4b535dce48d5cb4ebe9b76283f176edda2fe1c15341e5eadf27fda67516554f
02c1f0ff4b76b93606214484e40a8db806d84add139b00af1bc4be4265abeddfbf
0035
fe8c27d768819443fc6c21bf3fec702a2dbe8e0ac6b6a22e066bd22a6111bf52dd7604821a4941b12c0942595b9af49ed8ab57f169
f040
4d1aac805348495d863979d1911fc329aab07f60ced8571ca15f208af2f7e3ef0c54e346ba7869a18d7a39b394ba6cea692b9abe37d930bf788c8edcbf1b631b
```

A payer offer with an unknown even record, type `12`, that is signed:

```
fe7741dfaf7d
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
0c0100
f040
2261762e01ffe20676a4b513dfcff011ab8552fb2d679984e76530ab81633627aab5f4f890cb12f0c0699ff914d21eac7680cdd3b7c4c4a7a2d7f8857d69e384
```

A payer offer with an `expiry` of the start of 2025, which has passed, that
is signed:

```
fe7741dfaf80
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
080467748580
f040
96ae5a1ddea8f56de877ffc1db8618126d3a3e328012bbfd80586bf4a5892c3ae220c9fba181fb61fdcb84d734ffcde03dc2cddfb9ff0a0989a14276fef5c4ed
```

A payer offer with an unknown odd record, type `1`, added after it was
signed, so that the signature does not cover it:

```
fe7741dfaf7d
0036
0a11537570706f727420746865206775657374
1621024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766
010100
f040
2f5026ef93efead6d492f2d60cd663c0010c21cdeb6f790c7cf41237cf37efb196d83a6b8a347dc53f09aaff8ec75d1765c5fe69084e81ce2907fec2666e3f79
```

### Support Note

The note `Thank you!` sealed to a payment preimage of 32 `0e` bytes, with a
`salt` of 16 `0c` bytes. The payment hash, the `note_key`, and the sealed
note are:

```
49cc2209d036c94d6e522c73af1fb6332a22a86b8a7722613864f5616bcaa9e4
ba1e5d0f1417a2fcf124eb54fcfb0f169b81fefe4fcaff667ba06f213b27a2af
0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c1277377bd4ee1c8bdba7fabb8485e432f1d244a34475ebbac207
```

As an `invoice_support_note` record:

```
feb2dca9ad2a
0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c
1277377bd4ee1c8bdba7fabb8485e432f1d244a34475ebbac207
```

- `feb2dca9ad 2a`: `invoice_support_note`, type `3000805805`, 42 bytes
- The 16 byte `salt`, then the 10 bytes of the sealed note and its 16 byte tag

A payer that paid with the preimage of 32 `0e` bytes reads the note
`Thank you!`. A preimage of 32 `0f` bytes cannot open it, and neither can
the preimage of 32 `0e` bytes when a byte of the `salt` is changed.

A payer MUST ignore this record, with a `salt` of 16 `0d` bytes, since with
the preimage of 32 `0e` bytes it opens to the byte `ff`, which is not valid
UTF-8 text:

```
feb2dca9ad21
0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
7b31b6a5ddc81924c0e859c3d219efc6d2
```

### Reply Size

An invoice error in reply to a request to pay that arrived in an onion
message of the regular size, whose invoice does not fit in one, with the
`error` `InvoiceTooLarge` and `reply_too_large`:

```
050f496e766f696365546f6f4c61726765
fe000c4baf00
```

- `05 0f ...`: `error`, `InvoiceTooLarge`
- `fe000c4baf 00`: `reply_too_large`, type `805807`, 0 bytes

The invoice error when the invoice would fit without the
`invreq_payer_offer` of the request, with `erroneous_field` set to
`2000805807`:

```
01047741dfaf
051250617965724f66666572546f6f4c61726765
fe000c4baf00
```

- `01 04 7741dfaf`: `erroneous_field`, `2000805807`
- `05 12 ...`: `error`, `PayerOfferTooLarge`
- `fe000c4baf 00`: `reply_too_large`, type `805807`, 0 bytes

A payer that sent either request in an onion message of the regular size
MAY send it again in a large one. An invoice error without `reply_too_large`
is not a reason to send a request again in a large onion message.

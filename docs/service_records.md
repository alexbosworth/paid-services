```
Title: Service Records
Status: Draft
Author: Alex Bosworth
Created: 2026-09-29
License: MIT
```

# Service Records

## Abstract

A service record holds the parts of a service that stay the same while it
runs, like the offer of a support offer service and the keys it uses, as
one sealed value. Only the node that made a record, or something that can
use its keys, can read it or change it, so the record can be stored outside
the node and given back to it to resume the service. Things that can change,
like a menu, are given to the service when it starts.

This document is informational. Service records are one way for a node to
store the services it runs, and other implementations do not need them to
work with the offers that the services answer.

## Copyright

This document is licensed under the MIT license.

## Motivation

A node that answers for an offer needs to know things that are not in the
offer: which key signs its invoices, which blinded paths are its own, and
how many requests to answer. Keeping these on the node ties the service to
the node's storage. A record lets whoever runs the service keep it with the
rest of their data, like in a configuration file, and start the service
from it.

Some of what a record holds has to stay secret. The `path_id` of an offer
path is what shows the node that a request came over a path it made, and
someone who knows it can make their own path with it to check which node
answers for the offer. So the data in a record is sealed, not only signed.

## Specification

The conventions are those of [Support Offers](support.md#conventions).

### Service Record

```
service_record = 626f73ff || record_tlv_stream
```

`record_tlv_stream` has these records:

| Type | Name | Value |
|------|------|-------|
| 0 | `service_type` | `tu64` service type |
| 2 | `service_version` | `tu64` version of the service |
| 4 | `record_key_index` | `tu64` index of the record key, below 2^31 |
| 6 | `salt` | 32 bytes |
| 8 | `sealed_data` | `service_data`, sealed |

`service_version` is the version of the service, as in a service label.
`service_data` is a TLV stream of the data for the service type.

The service types are:

| Service Type | Service |
|--------------|---------|
| 1 | Support offer |

### Record Key

A node has a record key for each `record_key_index`. It is derived from a
secret that can only be derived with a key that the node holds: the shared
secret of the node's key at that index and `record_point`.

```
record_secret = SHA256(compressed(k * record_point))
record_key = HMAC-SHA256(key = record_secret,
  message = "service-records/record-key")
```

`k` is the private key of the node's key at `record_key_index`, among keys
that the node only uses for record keys.

`record_point` is a point with no known private key. It is the first
`02 || x` that is a valid point, where:

```
x = SHA256("service-records/record-point" || counter)
```

and `counter` is written as a decimal string, starting at `0`. The first
valid point is at counter `0`:

```
022cc75db0208e2d2daa3ccfd76c011cd9ec889334e355dfd96bd1b1840f52c377
```

### Sealing

Each record is sealed with its own key, derived from `record_key` and the
record's `salt`:

```
seal_key = HMAC-SHA256(key = record_key, message = salt)
```

`sealed_data` is `service_data` sealed with ChaCha20-Poly1305, as defined in
RFC 8439, with `seal_key` as the key and 12 zero bytes as the nonce. The
value is the ciphertext followed by the 16 byte tag.

The associated data is the service record as it is, with the bytes of the
`sealed_data` record cut out and nothing else changed. It includes
`626f73ff`, and every other record, before or after `sealed_data`, including
records that the reader does not know. A reader MUST NOT leave out,
reorder, or encode again any record to make the associated data.

RFC 8439 requires that a key and nonce pair is never used twice. Every
`seal_key` seals one record, so the nonce can always be zero.

### Writing and Reading

The writer of a service record:

- MUST set `service_type`, `service_version`, `record_key_index`, `salt`, and
    `sealed_data`.
- MUST set `record_key_index` to the index of the record key it seals with,
    which MUST be below 2^31.
- MUST use a new `salt` of 32 bytes from a cryptographically secure random
    source for each record, and MUST NOT seal more than one record with the same
    `record_key` and `salt`.

The reader of a service record:

- MUST NOT use the record when it does not start with `626f73ff`, its TLV stream
    is not valid, or it does not have a `service_type`, a `service_version`, a
    `record_key_index`, a 32 byte `salt`, and a `sealed_data` of at least 16
    bytes.
- MUST NOT use the record when its `record_key_index` is not a valid `tu64` or
    is 2^31 or more, and MUST NOT use it when its `record_key_index` is not one
    that the reader accepts.
- MUST make each of the checks above before it derives any key, and MUST NOT
    derive a key for a record that fails one.
- SHOULD accept only a set or range of `record_key_index` values that it keeps,
    like the indexes that it has sealed records with, and MAY stop accepting an
    index to refuse every record sealed with it.
- MUST open `sealed_data` with the `seal_key` of the record key of
    `record_key_index` and the record's `salt` before it uses the service type,
    the version, or the data, and MUST NOT use the record when it cannot be
    opened.
- MUST NOT use the record when it has an unknown even type.
- MUST NOT use the record when it does not support the `service_type` or the
    `service_version`.

### Support Offer Data

The `service_data` of a support offer service record has these records:

| Type | Name | Value |
|------|------|-------|
| 0 | `offer` | The offer, as its TLV stream bytes |
| 2 | `key_index` | `tu64` index of the `offer_issuer_id` key, below 2^31 |
| 4 | `path_ids` | List of the `path_id` values of the offer paths, each at least 16 bytes |
| 6 | `max_unpaid_invoices_per_hour` | `tu64` limit on unpaid invoices |
| 8 | `max_requests_per_hour` | `tu64` limit on requests answered |

`max_unpaid_invoices_per_hour` limits how many of the invoices made in the
last hour can be unpaid. A request to pay that would go over it is sent an
invoice error. `max_requests_per_hour` limits how many requests to pay are
answered in the last hour, and separately how many menu requests are, so
that menu requests do not use up the requests to pay. Requests that would
go over it are not answered.

The writer of support offer data:

- MUST set `offer`, `key_index`, and `path_ids`.
- MUST set the `path_id` of each offer path to at least 16 bytes from a
    cryptographically secure random source, both for a path that it makes and
    for a path that it is given, like one made by another program, and MUST NOT
    write a record with a `path_id` shorter than 16 bytes.
- MUST keep each `path_id` private: it MUST NOT show a `path_id` to anyone other
    than in the encrypted data of its own offer path, for the node at its end,
    and sealed in a record.
- MUST set `key_index` to the index of the `offer_issuer_id` key, among keys
    that the node only uses for offer issuer keys, below 2^31.
- MUST NOT set a limit to `0`.

The reader of support offer data:

- MUST NOT use the record when `offer` is not a support offer, or its label has
    another `service_type` or `service_version` than the record.
- MUST NOT use the record when the key at `key_index` is not the
    `offer_issuer_id` of the offer.
- MUST NOT use the record when a limit is `0`, or when `key_index` is 2^31 or
    more.
- MUST NOT use the record when `path_ids` has no `path_id`, or has a `path_id`
    shorter than 16 bytes.
- MUST only answer an invoice request that arrives on a path with a `path_id` in
    `path_ids`, and whose records in the BOLT 12 offer ranges, 1 to 79 and
    1000000000 to 1999999999, are exactly the records of either `offer` or a
    related offer that the service is configured to answer, with the
    `offer_paths` of `offer` in place of any of its own.
- MUST NOT answer an invoice request for an offer because it has the
    `offer_issuer_id` of `offer`, since anyone can make an offer with any
    `offer_issuer_id`.
- MUST sign invoices with the key at `key_index`.

When a limit is left out, the service uses a limit of its own, like 100
unpaid invoices from the last hour and 1000 requests an hour.

Related offers are not in the record, since they can change. They are given to
the service when it starts, like the offers that the menu of a support offer
lists without their paths, as described in [Support Offers](support.md). A
request for such an offer arrives on the paths of `offer`, so its offer records
are those of the related offer with the `offer_paths` of `offer`.

## Rationale

**Why seal the data?** The record has the path ids of an offer, and they
have to stay secret. ChaCha20-Poly1305 hides the data and checks that the
record was made with the key and not changed, so one key and one check do
both.

**Why at least 16 random bytes in a path id?** A `path_id` is what tells the
node that a request came over a path that it made. Someone who could guess one
could make a path of their own with it and check which node answers for the
offer. 16 bytes from a secure random source cannot be guessed. A path that the
writer is given has to meet the same rule, since a short or predictable
`path_id` from anywhere shows the node the same way.

**Why only related offers that the service is configured with?** BOLT 12 offers
are not signed, so anyone can make an offer with the `offer_issuer_id` and the
paths of a support offer, and any text or amount. A service that answered any
offer of the issuer would sign invoices for those offers, which repeat their
records, so it would sign what the recipient never offered. A service only
answers the offers that it was given, each exactly as it was given.

**Why is every other record associated data?** Every record outside the
sealed data is checked with it, including records added later with any type,
so no part of a record can be changed without the key. The associated data
is the bytes as they were received, so a reader that does not know a record
still checks it, and a reader that left out records that it does not know
could not open records made by a later writer.

**Why a record key index?** A node can seal new records with the key of a
new index, like after the key of an index leaked, and can refuse records
sealed with an index that it no longer uses, which revokes all of them at
once.

**Why indexes below 2^31?** Indexes below 2^31 are valid key indexes for
common signers, like non-hardened BIP 32 indexes, and fit in any 32 bit
integer, so a reader never has to convert or wrap a larger number.

**Why check the index before deriving a key?** A record can come from
outside the node, and it names the index to derive a key for. Checking the
index against the indexes that the reader accepts first means that a record
cannot make the node use its signer for any other index, or for many
indexes.

**Why a point with no known private key?** A shared secret with a point whose
private key someone knows could be derived by them from the node id. With no
known private key, it can only be derived with the node key.

**Why derive the key with a tag?** The record secret could be used for other
purposes later. Deriving the key with a tag keeps the keys for each purpose
different.

**Why a salt and a key for each record?** RFC 8439 requires a nonce that is
never used twice with a key, so it must not be random, and suggests a
counter. A counter needs state that the node keeps for every record it
makes, and service records are meant to need none. Instead, every record
has its own `seal_key`, from a salt of 32 random bytes, and each `seal_key`
seals one record, so the nonce can be zero. Two records only share a
`seal_key` when they share a salt, which 32 random bytes make too unlikely
to happen.

**Why the same version encoding as the service label?** The record and the
offer describe the same service, and one encoding is less to get wrong.

## Security Considerations

**Signer access.** Anything that can use the node's keys to derive a shared
secret, like a client of the node with permission to use its signer, can
derive the record key of any index, and so read records and make new ones.
After a record key leaks, new records can be sealed with a new index, but
records sealed with the old index can still be read by whoever has the
leaked key.

**Old records.** A single record cannot be revoked, only every record of a
`record_key_index`. Whoever has an old record can give it back to the
service, like a record with higher limits or for an offer that should no
longer be answered. A node that has to stop answering for an offer has to
stop using its record, and keep it from being given back.

**Shared limits.** The limits are for all requests to an offer together, so
someone who sends many requests can use up a limit for everyone else.

**What a record shows.** The sealed data is hidden, but the service type and
version are not, and the length of a record shows about how much data it
has.

## Test Vectors

A support offer record with a `record_key_index` of `0`, for a node
whose key at that index has the private key of 32 `05` bytes, and the public
key:

```
0362c0a046dacce86ddd0343c6d3c7c79c2208ba0d9c9cf24a6d046d21d21f90f7
```

Its `record_secret` and `record_key`:

```
0b2009d7734b08f893158986f08c13d320d7ce9dbcf7d26f2811feb11759d8dc
5267c52cd4c611a34368b5b8bfa5005363f7ea31fde7942948eedb71819ff9f6
```

The `service_data` has the support offer from the
[Support Offers](support.md#test-vectors) test vectors, a `key_index`
of `0`, the `path_id` of the offer path, and limits of 50 unpaid invoices
and 500 requests an hour:

```
00fd015f
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
001000000000000f
424000000000004c
4b40
0200
0421200a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a
060132
080201f4
```

- `00 fd015f`: `offer`, 351 bytes, as in the support offer vector
- `02 00`: `key_index` `0`
- `04 21 20 ...`: `path_ids`, one 32 byte `path_id`
- `06 01 32`: `max_unpaid_invoices_per_hour` `50`
- `08 02 01f4`: `max_requests_per_hour` `500`

With a `salt` of 32 `0b` bytes, the `seal_key` is:

```
54dd6ef6aec9f1e79f45a64bce6ecc65f5f5ed220289dee4aee586e3e9d28166
```

The record. The sealed data is split into lines of 32 bytes:

```
626f73ff
000101
020101
0400
06200b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b
08fd019f
786ebea9264b9977036b99b507df1b54bddc5f4ecb0d5f6cb407839edbd3ffc4
3f7fd9d77e687c39292c7c467e2218d12d01e13217451e8e669e7575b37df5e4
438f0b121538d60676319177d28a6af1a61d76c2dc07a6d1bf971acc00a92ac3
ce8bc06a1780e403e6b61240caf51fa47e8ec7e90bc44e138093330f1405d7b7
74355291edeca810d17ab44e7b7b4ab24ce543019c5934e982077c9eddf2975c
9a509fb95380c35a829becc81dbf6e986406db6c52555df300f18ab9a4d1c8f1
0c8189b20ec37076e11b9dcae0a3be934d7b42177af452abf7e6ede167afe9fc
5bb2c944e85f096108db64b8c236fa47e0f35aeb01b3d53c42ea52028b9437bd
aef9efc29be468dd3c22af23cdb2299dd32451244f65bb32b67e36bea9cbfa2a
4513dbdbe1bb0040edbafed3090a1ae995b33f4485392ea76adbdddd4ddf3b40
70d8347ef1de086470962f2fcd3005ee41b0591c146e8cac45f2d12aa43af60e
acc158b0a2d7fa59f4b2983d84642634dea144eae84d0fb97fd2dd67f6220603
d5be69403abcd7b9a1f3674d595893bff0a8d7da0aad28f0ff6ef089cc5b53
```

- `626f73ff`: prefix
- `00 01 01`: `service_type` `1`
- `02 01 01`: `service_version` `1`
- `04 00`: `record_key_index` `0`
- `06 20 ...`: `salt`
- `08 fd019f ...`: `sealed_data`, 415 bytes: 399 bytes of ciphertext and a 16
    byte tag

A reader MUST NOT use the record when any byte of it is changed.

A record with the same data, a `salt` of 32 `0c` bytes, and two unknown odd
records: type `7`, before `sealed_data`, and type `9`, after it. A reader
MUST read it, and a reader that leaves out the unknown records before it
opens the record finds that it cannot be opened:

```
626f73ff
000101
020101
0400
06200c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c
070100
08fd019f
9e15e4ad574f734ea3046115cb3c8285bcfab1a9ee40b08e22a4f1bff7d0cf32
a81835e4d698cbabbe1785973fb0d5119bea764bd9f216c8d0cf7e4296f89c99
3ec9f93e0d5c173df740b407d3d0b2b2cff577c6bdeb9f22c3abee70af3d2749
699ed53f9ed12fe2e1e7d137d0996df098145c28f1b3f12f33df92da5352d501
5dfe58530f1c25c8488bc3f5217effe76cf19b9286c11167e5dda1e3cb305583
3b17ebf63850bfaab77e59a5dcfbd9b197f86253eb7076422c55827b142cb107
929cbbb9d945598902e0cc4f5d39ef55df3df75f2b69ca65ca44e1aef33ecabb
1714feac7c6a2d84687a1733ce07a01b1ef9b5b174dd4558816ac543b9468141
a5bd353509546d794e74cae99f6da0b97e12d9943ba36153c66bbf29cad5b0b4
0a56c5a2fa29f4383f276278b39d2c4eb8f194ea4d41c0ec6a3fa5bd2905dab9
3b06ba9d001f2c8e806999033b1d2eacdf72abde3d7e495a28c9d5c118e4ce55
20f82eb4a5eea8606cd7417ab485b113334960f0f35569fb7cd222ef2d96321c
168752cd1bdfe485a789dc92e9be22dda1248ed002c7592046245d4b3a6c74
090100
```

- `07 01 00`: an unknown odd record
- `09 01 00`: an unknown odd record, after `sealed_data`

The first record above with a `record_key_index` of 2^31. A reader MUST NOT
use it, and MUST NOT derive a key for it:

```
626f73ff
000101
020101
040480000000
06200b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b
08fd019f
786ebea9264b9977036b99b507df1b54bddc5f4ecb0d5f6cb407839edbd3ffc4
3f7fd9d77e687c39292c7c467e2218d12d01e13217451e8e669e7575b37df5e4
438f0b121538d60676319177d28a6af1a61d76c2dc07a6d1bf971acc00a92ac3
ce8bc06a1780e403e6b61240caf51fa47e8ec7e90bc44e138093330f1405d7b7
74355291edeca810d17ab44e7b7b4ab24ce543019c5934e982077c9eddf2975c
9a509fb95380c35a829becc81dbf6e986406db6c52555df300f18ab9a4d1c8f1
0c8189b20ec37076e11b9dcae0a3be934d7b42177af452abf7e6ede167afe9fc
5bb2c944e85f096108db64b8c236fa47e0f35aeb01b3d53c42ea52028b9437bd
aef9efc29be468dd3c22af23cdb2299dd32451244f65bb32b67e36bea9cbfa2a
4513dbdbe1bb0040edbafed3090a1ae995b33f4485392ea76adbdddd4ddf3b40
70d8347ef1de086470962f2fcd3005ee41b0591c146e8cac45f2d12aa43af60e
acc158b0a2d7fa59f4b2983d84642634dea144eae84d0fb97fd2dd67f6220603
d5be69403abcd7b9a1f3674d595893bff0a8d7da0aad28f0ff6ef089cc5b53
```

The first record above with a `path_id` of 15 `0a` bytes instead, and a `salt`
of 32 `0d` bytes. It opens with the record key, but a reader MUST NOT use it,
since its `path_id` is shorter than 16 bytes:

```
626f73ff
000101
020101
0400
06200d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d
08fd018e
211ff95dc9af51876aaf8ba861a2cad883f85dedf1628d4e6d31a5033fd55462
0b398c6eb37099b38202f6f89b9f20fcceca61162f3532b1a79b355a82f44b23
3b53c77107b8a339cc8a433d15b25a8649aef62e8f684ff1c8745c0316f039a5
05440ad92bc6028b156f01e87022f8542e8ab00b1047e540f42b4d8be739e9bd
90977ac5af039f25daf6fc8a3f0ee721c3e91039045c78baef9116cb9c88f801
33a8c21012c05c2094a2e88124380e22dc6e61fbd54bd21911cd5dbab4bfe59e
013813bb10379ef9c668f99fa5c441386dc0a122cefd2c99a0d9607bac4620e0
322094c897b1b508f773db3f585db06c5ec804f85d77cfc534a0ca16da660915
07c7ff00753268b93b8ad90f48f22eedd19b331690137ebea927d3779440fa8f
7db87971f9d7a382bc80d033921d15b5eeed25acaccdfee4924ac5d21af106cd
5982f7e3612f27ca53c9760cdc07272e9b0486965874361a52d65315189a9101
8be7be4d2778e0f75e185db756b735467d56a820349ebc282df7b45cb08e9422
c659c806a91c91ba8f80b53a1d31
```

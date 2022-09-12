const {test} = require('@alexbosworth/tap');

const method = require('./../../swaps/decode_loop_response');

const tests = [
  {
    args: {},
    description: 'A response is expected',
    error: 'ExpectedNetworkNameToDecodeLoopResponse',
  },
  {
    args: {
      network: 'regtest',
      response: '01e20003fd015301d40c62fbaa810d1039876b33355313a2d087f02fcfbf7813d3180a079c910610b9901ced8fc4af81a05383932b830bc98009f1300be1338018a4044759ffafe6c768b239d0c1db50e1fd46a5d302425b144bd2d41d7d46ff55c510420c0a00002e0002000000000000000000504034b7e45aac59bf6b164f311a72c686244dade0c8fa6bd171656579b381700bda0702808484006152edd8b88b5fff1041a82dc8033a433d3d5717e7a9135f8e90d844939270a6f3e011db49e80313908bfc2e7ff54ac07f2ef50354f58d2f080c6f0620956c56020205fe01c9c38002fd01660003fd022301fd01560c62fbaa810d29ce433e24e378ee911c282632a54e7e23f84e1d38228019e29ec3c6019109b181a42b9bbb0b810169039b1b934b83a1d101a9899181c9c30989c311a19b3199c321933191cb0b2189b18b2b299981c1832199c9bb0b11931999b19329ab219329818999b31b318b19a3198181b1bb0b098b319199ab0013e26017c267003148088eb3ff5fcd8ed16473a183b6a1c3fa8d4ba60484b62897a5a83afa8dfeab8a208421940000c40004000000000000000000a018a4044759ffafe6c768b239d0c1db50e1fd46a5d302425b144bd2d41d7d46ff55c510420c0a00002e0002000000000000000000504034e3767e0e53af1c3e853eb681e736207c41d5b992c598583f22f3d0dbd802dd2f028084840013a606e9b401e55262f19336da615cf7a86a0d712cac6d76a80ed88f7a886bfc21263efd9cb77ae805d2d2f9247e1c5263106b0be0d02335c332251b8c436802000205fe0d26e9b003810201046c7361740242000016bdf758f869bb591e4b319a06163d5405e8797829f0729818e9e7194952a9fa2f77621fbcf7978311c82d805b936cf38c7f6e9865f5d7f9b54a47262273957300020f73657276696365733d6c6f6f703a3000000620444144ca16c4ba45b0c70dbbdc5df44e3758258c4f7e23225717c6986b1b9fdc0420835daaac9cd2a8bfb300c51583262f46c6f4305b2d0d6b5b4bba8b8867a1bd8d052103b8940114a42d5f687568bf7dc0d791d745c18beb8e3d3aa855fd0027fabdc0dd0605fe0023cc46',
    },
    description: 'A loop response is decoded',
    expected: {
      auth_macaroon: 'AgEEbHNhdAJCAAAWvfdY+Gm7WR5LMZoGFj1UBeh5eCnwcpgY6ecZSVKp+i93Yh+895eDEcgtgFuTbPOMf26YZfXX+bVKRyYic5VzAAIPc2VydmljZXM9bG9vcDowAAAGIERBRMoWxLpFsMcNu9xd9E43WCWMT34jIlcXxphrG5/c',
      auth_preimage: '835daaac9cd2a8bfb300c51583262f46c6f4305b2d0d6b5b4bba8b8867a1bd8d',
      deposit_id: '40e61dacccd54c4e8b421fc0bf3efde04f4c60281e72441842e64073b63f12be',
      deposit_request: 'lnbcrt300u1p330h25pp5grnpmtxv64xyaz6zrlqt70haup85ccpgreeygxzzueq88d3lz2lqdq2wpex2urp0ycqz03xq97zvuqrzjqg36el7h7d3mgkguapswm2rsl63496vpyykc5f0fdg8tagml4t3gsggxq5qqq9cqqyqqqqqqqqqqqqqq9qsp5klj94tzeha43vne3rfevdp3yfkk7pj86d0ghzet90xeczuqtmgrs9qyyssqxz5hdmzugkhllzpq6stwgqvayx0fa2ut702gnt78fpkzyjwf8pfhnuqgakj0gqvfepzlu9ell2jkq0uh02q657kxj7zqvdurzp9tv2cptlc6fa',
      deposit_tokens: 30000,
      fund_id: 'a7390cf8938de3ba4470a098ca9539f88fe13874e08a00678a7b0f18064426c6',
      fund_payment: 'e3767e0e53af1c3e853eb681e736207c41d5b992c598583f22f3d0dbd802dd2f',
      fund_request: 'lnbcrt2206540n1p330h25pp55uuse7yn3h3m53rs5zvv49felz87zwr5uz9qqeu20v83spjyymrqdy9wdmkzupq95s8xcmjd9c8gw3qx5cnyvpe8psnzwrzxsekvvecvsexvv3ev9jrzd33v4jnxvpcxpjrxwfhv93rycenxcex2dtyxfjnqvfnxe3kvvtrx33nqvpkxaskzvtxxgen2cqz03xq97zvuqrzjqg36el7h7d3mgkguapswm2rsl63496vpyykc5f0fdg8tagml4t3gsgggv5qqqvgqqyqqqqqqqqqqqqqq9qrzjqg36el7h7d3mgkguapswm2rsl63496vpyykc5f0fdg8tagml4t3gsggxq5qqq9cqqyqqqqqqqqqqqqqq9qsp5udm8urjn4uwrapf7k6q7wd3q03qatwvjckv9s0ez70gdhkqzm5hs9qyyssqp8fsxax6qre2jvtcexdk6v9w002r2p4cjetrdw65qaky002yxhlppycl0m89h0t5qt5kjlyj8u8zjvvgxkzlq6q3ntsejy5dccsmgqgqw56lgh',
      fund_tokens: 220654,
      remote_public_key: '03b8940114a42d5f687568bf7dc0d791d745c18beb8e3d3aa855fd0027fabdc0dd',
      timeout: 2346054,
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      const res = method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});

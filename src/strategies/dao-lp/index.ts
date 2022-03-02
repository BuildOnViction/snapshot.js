// Inspired by https://github.com/snapshot-labs/snapshot.js/blob/master/src/strategies/uniswap/index.ts
import fetch from 'cross-fetch';
import { formatUnits } from '@ethersproject/units';
import { multicall } from '../../utils';
import { subgraphRequest } from '../../utils';
import { abi as multicallAbi } from '../../abi/Multicall.json';

export const author = 'anhnt';
export const version = '0.1.0';
import LUAFarmABI from "./lua-farm-abi.json";
import { Interface } from '@ethersproject/abi';
import _strategies from '../../strategies';
import networks from '../../networks.json';
import BigNumber from 'bignumber.js'
const Web3 = require('web3')
var BN = Web3.utils.BN;

const abi = [
    {
        constant: true,
        inputs: [
            {
                internalType: 'address',
                name: 'user',
                type: 'address'
            },
            {
                internalType: 'address',
                name: 'token',
                type: 'address'
            }
        ],
        name: 'balanceOf',
        outputs: [
            {
                internalType: 'uint256',
                name: '',
                type: 'uint256'
            }
        ],
        payable: false,
        stateMutability: 'view',
        type: 'function'
    }
];

async function subgraphLuaswapRequest(url: string, query, options: any = {}) {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...options?.headers
        },
        body: JSON.stringify(query)
    });
    const { data } = await res.json();
    return data || {};
}

const lpTokenAddress = "0x88ba0bd9e1f90ccc21bdf7d33cb67fa5743da036";
const stakedAddress = "0x8Bcf7880d2Bae3E2705e7D90D28Bd417bd29020d";

async function multicallLuaFarm(network, blockTag, calls) {
    console.log(network.multicall, blockTag, calls[0][0], calls[0][1], calls[0][2])
    console.log(multicallAbi)

    const web3 = new Web3(new Web3.providers.HttpProvider(networks[network].rpc[0]))
    const multi = new web3.eth.Contract(multicallAbi, networks[network].multicall);

    const itf = new Interface(LUAFarmABI);

    try {
        const res = await multi.methods.aggregate(
            calls.map((call) => [
                call[0].toLowerCase(),
                itf.encodeFunctionData(call[1], call[2])
            ])
        ).call({}, blockTag);

        return res;
    } catch (e) {
        return Promise.reject(e);
    }
}

export async function strategy(
    space,
    network,
    provider,
    addresses,
    options,
    snapshot
) {
    const blockTag = typeof snapshot === 'number' ? snapshot : 'latest';

    const lpTokenAddress = options.lpTokenAddress.toLowerCase();

    // const tokenAddress = options.tokenAddress.toLowerCase();

    // const result = await subgraphRequest(UNISWAP_SUBGRAPH_URL[network], params);
    // get reserve balance
    const pairsInfo = await subgraphLuaswapRequest(
        "https://api.luaswap.org/subgraphs/name/phucngh/Luaswap3",
        {
            "operationName": "pairByAddress",
            "variables": {
                "pairAddress": "0x88ba0bd9e1f90ccc21bdf7d33cb67fa5743da036",
                "block": blockTag
            },
            "query": "query pair($pairAddress: Bytes!, $block: Int!) {\n  pairs(where: {id: $pairAddress}, block: {number: $block}) {\n  id\n  reserve0\n  reserve1\n  reserveUSD\n  totalSupply\n  }\n}\n"
        }
    ); 
    console.log(pairsInfo);
    // get staked balance then convert to to LP balance
    let stakedLPBalances = await multicallLuaFarm(
        network,
        blockTag,
        addresses.map((address: any) => [
            stakedAddress,
            'userInfo',
            [0, address]
        ])
    );
    console.log(stakedLPBalances);

    // get LP balance
    const lpBalances = await multicall(
        network,
        provider,
        abi,
        addresses.map((address: any) => [
            lpTokenAddress,
            'balanceOf',
            [address]
        ]),
        { blockTag }
    );
    console.log(lpBalances);

    // sum up
    let stakedTDAO = stakedLPBalances.returnData.map((stakedBalance, index) => {
            return new BigNumber(lpBalances.returnData[index].substring(2, 66), 16)
            .plus(new BigNumber(stakedBalance.substring(2, 66), 16))
            .multipliedBy(new BigNumber(pairsInfo.pairs[0].reserve0))
            .multipliedBy(new BigNumber(2))
            .div(new BigNumber(pairsInfo.pairs[0].totalSupply))
        // return new BN(lpBalances.returnData[index].substring(2, 66), 16).add(
        //     new BN(stakedBalance.substring(2, 66), 16)
        // ).mul(
        //     new BN(pairsInfo.pairs[0].reserve0)
        // ).mul(
        //     new BN(2)
        // )
        // .div(
        //     new BN(pairsInfo.pairs[0].totalSupply)
        // );
    });

    return Object.fromEntries(
        stakedTDAO.map((value, i) => [
            addresses[i],
            //   parseFloat(formatUnits(value.toString(), options.decimals))
            parseFloat(new BigNumber(value).div(10 ** parseInt(options.decimals)).toString(10))
        ])
    );
}

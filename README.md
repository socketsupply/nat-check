## nat-check

a cli tool to create and test your ability to create p2p connections.

an implementation of the NAT-check tool described in the paper:

"Peer-to-Peer Communication Across Network Address Translators" (Ford 2005)

(see section 6 - 6.1.1)

this module is not intended for actually building a p2p system, but just for testing connections
and understanding how the p2p connection process works.

## install

```sh
npm install @socketsupply/nat-check -g
```

## summary

NAT Check tests NATs for reliable UDP behavior
// /and TCP hole punching: consistent endpoint translation,
// and silently dropping unsolicited incoming TCP SYNs

NAT Check is a client program behind the NAT, 
and 3 servers at different global IP addresses.

To test the NAT’s behavior for UDP, the client sends pings to servers 1 and 2

servers 1 & 2 each reply with the client’s public UDP
ip and port.

If the two servers report the same public endpoint for the client,
Then the client is on an "easy nat",
The NAT preserves the identy of the client's private endpoint,
so holepunching should be easy.

If the two responses return different ip addresses it's considered
a "hard nat".

Server 2 also forwards a message to server 3 which replies
to the client. If the client receives this message,
then the NAT does not filter "unsolicited" incoming traffic.

If the client is able to receive the message from the 3rd server then it's got a statically open firewall
and so can receive direct connections

If the client has the same port in the responses from 1 and 2
then it's easy nat. if it receives the message from 3 it's semistatic.
if 1 and 2 have different ports it's a hard nat.

## nat types

* easy nat - you can connect to static servers, easy nats, and hard nats via birthday paradox connection. home wifi is usually an easy nat. mobile networks may use an easy nat.
* hard nat - you can connect to static servers and easy nats (via birthday paradox) but need a relay to connect to other hard nats. corporate wifi is usually a hard nat. some mobile networks use hard nats.
* static server - you can connect to and receive connections from easy and hard nats and other static servers. a datacenter VM could be a static server but you can also make a static server by configuring port forwarding on your home router.

## usage

### nat-check check

sends messages to the 3 servers and tells you wether you are on an easy nat, hard nat, or have a static address.
will output your nat-type and instructions for how to connect to this peer.

copy the instructions to your friend on another network so they can connect to you

### nat-check peer {remote ip:port}

connect to a remote peer. the remote peer must run the same command at about the same time.

### nat-check bd_hard {remote ip:port}

make a bdp connection from a hard nat to a peer on an easy nat.
the remote peer needs to run the db_easy command.

### nat-check bd_easy {remote ip:port}

make a bdp connection from a easy nat to a peer on an hard nat.
the remote peer needs to run the db_hard command.

### nat-check timer

tests how long your nat keeps port mappings alive, using the same servers as the `check` command.

### nat-check server1|server2|server3

used to set up the servers that make `check` command work. read section 6 of the paper for a description of how it works.

# Roles Model


This document describes how users, roles and permissions are controlled in merits.

# Objective

Anybody can create a new user, going through our 'challenge-response' flow to ensure a user ID controls the publicKey for that user.

After a successful challenge-response, the user has permissions resolved from their role, and a short-lived session token is granted which contains those permission claims.

New users default to having the 'anon' role, which permissions are configured to restrict them to only be able to send messages to the onboarding group.

This way the onboarding users can KYC / AML / Onboard new users, giving them new roles, or putting them in new groups.

# Behaviour

## New Users
 * Anybody can create a new user (AID and public key pair), but have to pass a challenge to ensure they are in control of that public key
 * Attempts to create an AID which already exists should fail
 * new users (AIDs) are given the 'anon' role, which is configured with permission which restrict them to only message certain groups. Upon creation of a new user, they are automatically put in a special 'onboarding' group (looked up by name), which contains the admins who can perform onboarding. The new users are NOT added to that group - they can only message that group.

## Administrators
 Users with the 'admin' role are permissioned to add users to groups, and to change users' roles. The governance behind these actions happens outside of merits, but as roles, permissions and mappings are added, we ensure only users with permissions to change those tables are allowed, and they must provide an 'actionSAID' (reference to the governance behind that action) when they do so. The system provides the authenticated user's adminAID and timestamp, taking it from their session token which also contains the current user's claims

Administrators are allowed to create other groups, and so can create a group for KYC, AML, or anything else which may be needed. The members in those groups will have roles which allow them to assign users to certain groups as well.

This way we can model a flow:

 * the people in the onboarding group can receive messages from new users and reply to those users
 * the onboarding group have an 'onboarding' role, which permissions them to assign users to the 'kyc' group.
 * the users in the kyc group have a 'kyc' role with permssions that allow them to insert users into the 'aml' group, etc

We can dynamically come up with new roles, permissions and groups, and the core merits mutations and actions all can check users' permissions before they:
 * create groups
 * update groups
 * delete groups
 * send a message to a group
 * read a message from a group
 * send a message to another user
 * ...

# Tables

To model the above behaviour, we use the following tables:

## Users

The Users table contains:

 * aid : the unique, required, non-empty primary key for this user
 * publicKey: (the user's current public key. Used to verify signed data from the user, and part of the challenge-response flow for authenticating). 
 * created: a creation timestamp

## UserRoles

The UserRoles table maps users to roles. It contains:

 * userAID : the foreign key into the Users table
 * roleSAID : the foreign key into the Roles table
 * adminAID : the foreign key to the admin user who made this entry
 * actionSAID : a required string reference to the data used to take this action
 * timestamp : when this row was created

## Roles

The roles table defines the available roles. It contains:

 * roleId : a unique ID primary key for this role
 * roleName : a friendly string name for this role
 * adminAID : the foreign key to the admin user who made this entry
 * actionSAID : a required string reference to the data used to take this action
 * timestamp : when this row was created

## RolePermissions

The RolePermissions table defines what permissions are associated with which role

 * id : a unique ID for this role/permission entry mapping, automatically generated
 * roleId : a foreign key into the Roles table
 * permissionId : a foreign key into the Permissions table
 * adminAID : the foreign key to the admin user who made this entry
 * actionSAID : a required string reference to the data used to take this action
 * timestamp : when this row was created


## Permissions

The Permissions table defines what permissions with unique keys which the rest of merits can check for to allow certain actions

 * permissionId : a unique ID for this permission, automatically generated
 * key : a unique key defining the permission (e.g. "can.join.groups", "can.assign.users.to.groups", "can.create.groups", ...). These keys should be defined as constants and references from mutations and actions which check them against user claims
 * data : an optional field which can contain json data to further refine the key. e.g. a json array of groupIds which accompanies an e.g. "can.message.groups" permission key
 * adminAID : the foreign key to the admin user who made this entry
 * actionSAID : a required string reference to the data used to take this action
 * timestamp : when this row was created

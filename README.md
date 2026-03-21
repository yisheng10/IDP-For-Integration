## Dependencies

# Download and install nvm:

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# in lieu of restarting the shell

\. "$HOME/.nvm/nvm.sh"

# Download and install Node.js:

nvm install 24

# Verify the Node.js version:

node -v # Should print "v24.12.0".

# Verify npm version:

npm -v # Should print "11.6.2".

## If on Windows (Download from the website use the .msi file)

https://nodejs.org/en/download

## Running the App

cd my-clinical-app # Should cd into this folder
npm install # One time only
npm run dev # Run this to run the website

## Deploying the App to the Internet (You guys should NOT do this, this is just for my reference)
npm install -g firebase-tools
firebase login
firebase init hosting #Type "dist" when prompted what is the public folder
npm run build
firebase deploy --only hosting

npm run build && firebase deploy --only hosting #Push updates to live server
firebase hosting:disable #Disable the live server
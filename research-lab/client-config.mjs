// The public demo and signed-in persistent workspace use separate URLs.
const privateView=typeof location!=='undefined'&&location.pathname.endsWith('/private.html');
export default Object.freeze(privateView
  ? {mode:'hosted',sharedEnabled:true,workerOrigin:'https://toto.jkapcar4.workers.dev',tenant:'jason-bdb'}
  : {mode:'browser',sharedEnabled:false});

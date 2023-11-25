package app

type BWBackupConfig struct {
	BW_ClientID	 	string	`default:"" env:"BW_CLIENTID"`
	BW_ClientSecret string	`default:"" env:"BW_CLIENTSECRET"`
	BW_HOST		 	string	`default:"https://vault.bitwarden.com" env:"BW_HOST"`
	BW_Password	 	string	`default:"" env:"BW_PASSWORD"`
	VC_Password		string	`default:"" env:"VC_PASSWORD"`
	USE_VC			bool	`default:"false" env:"USE_VC"`
	DEBUG			bool	`default:"false" env:"DEBUG"`
}

func (c *BWBackupConfig) GetBWClientID() string {
	return c.BW_ClientID
}

func (c *BWBackupConfig) GetBWClientSecret() string {
	return c.BW_ClientSecret
}

func (c *BWBackupConfig) GetBWHost() string {
	return c.BW_HOST
}

func (c *BWBackupConfig) GetBWPassword() string {
	return c.BW_Password
}

func (c *BWBackupConfig) GetVCPassword() string {
	return c.VC_Password
}

func (c *BWBackupConfig) GetDebug() bool {
	return c.DEBUG
}

func (c *BWBackupConfig) GetUseVC() bool {
	return c.USE_VC
}